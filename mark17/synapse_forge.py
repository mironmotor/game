"""Кузница синапсов — семантический kNN-бриджинг к 1M ПОЛЕЗНЫХ связей.

Берёт эмбеддинги памяти/концептов (vector_memory), считает косинусную близость и
вяжет каждый узел с k ближайшими ПО СМЫСЛУ соседями (relation=similar_to,
weight=похожесть). Пары упорядочены по id → дедуп через upsert. После ковки —
prune_weak убирает дохлые рёбра, чтобы граф рос полезным, а не мусорным.

Качество связей = качество эмбеддингов: на нейро (Ollama/Gemini) рёбра осмысленные,
на хэш-фолбэке — лексические. Локально, детерминированно.

Оптимизация: вместо N*k индивидуальных upsert_synapse() (каждый открывает своё
соединение) — накопление BulkRecord + периодический bulk_upsert() одной
транзакцией. ~20-50x быстрее на 100k+ узлах.
"""

from __future__ import annotations

import hashlib
import time
from collections import Counter
from typing import Any

import numpy as np

from mark17.synapse_graph import BulkRecord

# Сколько записей накапливать перед flush-ом в БД.
# Баланс между размером транзакции и частотой коммитов.
_FLUSH_SIZE = 10_000


def forge(
    vector_memory: Any,
    synapse_graph: Any,
    *,
    k: int = 10,
    min_sim: float = 0.45,
    max_nodes: int = 60_000,
    block: int = 1024,
    normal_degree_cap: int = 40,
    compressed_degree_cap: int = 20,
    pattern_degree_cap: int = 15,
) -> dict[str, Any]:
    started = time.perf_counter()
    M, ids_list, imp_list, event_types = vector_memory.forge_vectors()
    if M is None or len(ids_list) < 3:
        return {
            "ok": True,
            "nodes": 0,
            "pairs": 0,
            "added": 0,
            "pruned": 0,
            "duration_sec": round(time.perf_counter() - started, 3),
            "note": "мало векторов для ковки",
        }

    M = np.asarray(M, dtype=np.float32)
    ids = np.asarray(ids_list, dtype=np.int64)
    imp = np.asarray(imp_list, dtype=np.float32)
    event_types_arr = np.asarray(event_types, dtype=object)
    N = len(ids_list)
    # Кап по узлам: берём самые важные (производительность + полезность).
    if N > max_nodes:
        order = np.argsort(-imp)[:max_nodes]
        M = np.ascontiguousarray(M[order])
        ids = ids[order]
        event_types_arr = event_types_arr[order]
        N = max_nodes

    vector_hashes = [hashlib.blake2b(row.tobytes(), digest_size=8).digest() for row in M]
    largest_duplicate_group = max(Counter(vector_hashes).values(), default=1)
    known_pairs, degrees = synapse_graph.memory_similarity_index()
    emitted_pairs: set[int] = set()

    def degree_cap(event_type: str) -> int:
        if event_type == "compressed_concept":
            return compressed_degree_cap
        if event_type == "consolidated_pattern":
            return pattern_degree_cap
        return normal_degree_cap

    caps = [degree_cap(str(event_type)) for event_type in event_types_arr]

    before = int(synapse_graph.count())
    kk = min(k, N - 1)
    # Search beyond an identical-vector group so clone filtering still leaves
    # room for real semantic neighbours.
    probe_k = min(N - 1, kk + min(largest_duplicate_group - 1, 1024))
    pairs = 0
    candidates = 0
    total_written = 0
    skipped_identical = 0
    skipped_hub = 0
    skipped_duplicate = 0

    # Батч-буфер для накопления BulkRecord
    buf: list[BulkRecord] = []

    # Блочный kNN: считаем (block x N) косинусов за раз — память ~block*N, без
    # полной NxN матрицы. Тянет десятки тысяч узлов.
    for start in range(0, N, block):
        end = min(N, start + block)
        sims = M[start:end] @ M.T  # (b, N), строки L2-нормированы → косинус
        b = end - start
        for bi in range(b):
            sims[bi, start + bi] = -1.0  # без самосвязи
        idx = np.argpartition(-sims, probe_k - 1, axis=1)[:, :probe_k]
        for bi in range(b):
            ci = start + bi
            idc = int(ids[ci])
            row = sims[bi]
            neighbours = idx[bi][np.argsort(-row[idx[bi]])]
            accepted = 0
            for nb in neighbours:
                nb = int(nb)
                s = float(row[nb])
                if s < min_sim:
                    continue
                idn = int(ids[nb])
                if idn == idc:
                    continue
                candidates += 1
                if vector_hashes[ci] == vector_hashes[nb] and np.array_equal(M[ci], M[nb]):
                    skipped_identical += 1
                    continue
                lo, hi = (idc, idn) if idc < idn else (idn, idc)
                pair_key = (lo << 32) | hi
                if pair_key in emitted_pairs:
                    skipped_duplicate += 1
                    continue
                is_new = pair_key not in known_pairs
                if is_new and (
                    degrees.get(idc, 0) >= caps[ci]
                    or degrees.get(idn, 0) >= caps[nb]
                ):
                    skipped_hub += 1
                    continue
                emitted_pairs.add(pair_key)
                if is_new:
                    known_pairs.add(pair_key)
                    degrees[idc] = degrees.get(idc, 0) + 1
                    degrees[idn] = degrees.get(idn, 0) + 1
                buf.append(BulkRecord(
                    source_type="memory",
                    source_id=str(lo),
                    target_type="memory",
                    target_id=str(hi),
                    relation_type="similar_to",
                    weight=s,
                    metadata={
                        "forge": True,
                        "source_degree": degrees.get(lo, 0),
                        "target_degree": degrees.get(hi, 0),
                    },
                ))
                pairs += 1
                accepted += 1
                if accepted >= kk:
                    break

        # Периодический flush — не копим гигантскую транзакцию в RAM
        if len(buf) >= _FLUSH_SIZE:
            total_written += synapse_graph.bulk_upsert(buf)
            buf.clear()

    # Финальный flush остатков
    if buf:
        total_written += synapse_graph.bulk_upsert(buf)
        buf.clear()

    after = int(synapse_graph.count())
    pruned = 0
    try:
        pruned = int(synapse_graph.prune_weak())
    except Exception:
        pruned = 0
    final = int(synapse_graph.count())
    useful = 0
    try:
        useful = int(synapse_graph.useful_count())
    except Exception:
        useful = final
    duration = max(time.perf_counter() - started, 1e-9)
    return {
        "ok": True,
        "nodes": N,
        "pairs": pairs,
        "candidates": candidates,
        "written": total_written,
        "before": before,
        "after_forge": after,
        "added": after - before,
        "pruned": pruned,
        "total": final,
        "useful": useful,
        "k": k,
        "probe_k": probe_k,
        "largest_duplicate_group": largest_duplicate_group,
        "min_sim": min_sim,
        "duration_sec": round(duration, 3),
        "pairs_per_sec": round(pairs / duration, 1),
        "writes_per_sec": round(total_written / duration, 1),
        "skipped_identical": skipped_identical,
        "skipped_hub": skipped_hub,
        "skipped_duplicate": skipped_duplicate,
        "degree_caps": {
            "normal": normal_degree_cap,
            "compressed_concept": compressed_degree_cap,
            "consolidated_pattern": pattern_degree_cap,
        },
    }

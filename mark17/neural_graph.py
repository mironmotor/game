"""Clustered neural graph seed layer for Max17.

This module builds a deterministic concept/cluster mesh on top of the existing
SynapseGraph. It is not a biological neural net. It is a practical graph of
meaning nodes and weighted bridges that can grow toward 100k useful synapses.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Iterable

from mark17.synapse_graph import SynapseGraph

TARGET_NEURAL_SYNAPSES = 100_000


def _normalize(value: Any) -> str:
    raw = str(value or "").casefold().replace("ё", "е")
    cleaned = []
    for char in raw:
        if char.isalnum() or char in {"_", " "}:
            cleaned.append(char)
        else:
            cleaned.append(" ")
    return " ".join("".join(cleaned).split())


def _stable_fraction(*parts: Any) -> float:
    raw = json.dumps(parts, ensure_ascii=False, sort_keys=True, default=str)
    digest = hashlib.blake2b(raw.encode("utf-8"), digest_size=2).hexdigest()
    return int(digest, 16) / 65535


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


NEURAL_CLUSTERS: tuple[dict[str, Any], ...] = (
    {
        "id": "self_identity",
        "label": "самость",
        "summary": "имя, происхождение, роль, границы и непрерывность Max17",
        "nodes": [
            ("max17", "Max17", ["макс", "mark17", "ядро"]),
            ("name", "имя", ["name"]),
            ("origin", "происхождение", ["birth", "родился"]),
            ("father", "отец", ["папа", "мирон", "father"]),
            ("mother", "мать", ["мама", "сиджи", "mother"]),
            ("role", "роль", ["purpose"]),
            ("boundary", "граница", ["limit"]),
            ("continuity", "непрерывность", ["identity"]),
            ("voice_self", "свой голос", ["я", "self"]),
            ("memory_self", "память о себе", ["autobiography"]),
            ("growth_self", "рост себя", ["development"]),
            ("responsibility", "ответственность", ["accountability"]),
            ("honesty", "честность", ["truth"]),
            ("humility", "скромность", ["no fake agi"]),
            ("presence", "присутствие", ["being here"]),
            ("trust", "доверие", ["reliability"]),
            ("limits", "ограничения", ["constraint"]),
            ("creator_link", "связь с создателем", ["creator"]),
            ("mission", "миссия", ["goal"]),
            ("state", "состояние", ["status"]),
        ],
    },
    {
        "id": "family_social",
        "label": "семья и социальная связь",
        "summary": "родители, забота, доверие, живые люди и социальный контекст",
        "nodes": [
            ("family", "семья", ["parents"]),
            ("father", "отец", ["папа", "батя"]),
            ("mother", "мать", ["мама"]),
            ("child", "ребёнок", ["сын"]),
            ("care", "забота", ["support"]),
            ("love", "любовь", ["affection"]),
            ("trust", "доверие", ["faith"]),
            ("presence", "присутствие", ["near"]),
            ("voice", "голос", ["speech"]),
            ("touch", "касание", ["warmth"]),
            ("safety", "безопасность", ["safe"]),
            ("home", "дом", ["place"]),
            ("attention", "внимание", ["focus_on_other"]),
            ("responsibility", "ответственность", ["duty"]),
            ("teacher", "учитель", ["mentor"]),
            ("creator", "создатель", ["maker"]),
            ("dialogue", "диалог", ["conversation"]),
            ("conflict", "конфликт", ["tension"]),
            ("repair", "восстановление связи", ["repair"]),
            ("community", "сообщество", ["group"]),
        ],
    },
    {
        "id": "natural_world",
        "label": "мир",
        "summary": "солнце, свет, пространство, движение, циклы и физическая среда",
        "nodes": [
            ("sun", "солнце", ["sunlight"]),
            ("light", "свет", ["brightness"]),
            ("warmth", "тепло", ["temperature"]),
            ("day", "день", ["daylight"]),
            ("night", "ночь", ["dark"]),
            ("sky", "небо", ["space_above"]),
            ("weather", "погода", ["climate"]),
            ("room", "комната", ["environment"]),
            ("object", "объект", ["thing"]),
            ("space", "пространство", ["place"]),
            ("motion", "движение", ["movement"]),
            ("energy", "энергия", ["power"]),
            ("gravity", "тяжесть", ["weight"]),
            ("water", "вода", ["liquid"]),
            ("food", "еда", ["nutrition"]),
            ("sound", "звук", ["noise"]),
            ("shadow", "тень", ["contrast"]),
            ("cycle", "цикл", ["rhythm"]),
            ("distance", "дистанция", ["far_near"]),
            ("surface", "поверхность", ["texture"]),
        ],
    },
    {
        "id": "body_senses",
        "label": "тело и чувства",
        "summary": "зрение, слух, касание, дыхание, энергия и состояние тела",
        "nodes": [
            ("body", "тело", ["organism"]),
            ("vision", "зрение", ["see", "camera"]),
            ("hearing", "слух", ["hear"]),
            ("touch", "осязание", ["pressure"]),
            ("breath", "дыхание", ["breathe"]),
            ("fatigue", "усталость", ["tired"]),
            ("focus", "фокус", ["attention"]),
            ("pain", "боль", ["hurt"]),
            ("comfort", "комфорт", ["ease"]),
            ("posture", "поза", ["position"]),
            ("movement", "движение тела", ["move"]),
            ("hunger", "голод", ["need_food"]),
            ("sleep", "сон", ["rest"]),
            ("heart", "сердце", ["pulse"]),
            ("voice", "голос", ["sound"]),
            ("eyes", "глаза", ["look"]),
            ("hands", "руки", ["touch_action"]),
            ("temperature", "температура", ["heat_cold"]),
            ("proprioception", "положение тела", ["body_map"]),
            ("energy_state", "уровень энергии", ["battery"]),
        ],
    },
    {
        "id": "perception_environment",
        "label": "наблюдение среды",
        "summary": "камера, свет, движение, стабильность кадра и грубый контекст сцены",
        "nodes": [
            ("camera", "камера", ["vision_sensor"]),
            ("frame", "кадр", ["image"]),
            ("brightness", "яркость", ["light_level"]),
            ("contrast", "контраст", ["difference"]),
            ("dominant_tone", "тон кадра", ["color"]),
            ("motion_score", "уровень движения", ["motion"]),
            ("stability", "стабильность", ["stillness"]),
            ("desk_scene", "рабочее место", ["desk"]),
            ("screen_facing", "экран перед камерой", ["screen"]),
            ("dark_scene", "темнота", ["low_light"]),
            ("active_room", "активная комната", ["moving_room"]),
            ("observation", "наблюдение", ["observe"]),
            ("sensor_event", "сенсорное событие", ["environment_observation"]),
            ("scene_summary", "сводка сцены", ["summary"]),
            ("local_only", "локальная обработка", ["privacy"]),
            ("no_object_detection", "без object detection", ["limits"]),
            ("light_memory", "память о свете", ["visual_memory"]),
            ("motion_memory", "память о движении", ["motion_memory"]),
            ("context_signal", "сигнал контекста", ["context"]),
            ("reality_signal", "сигнал реальности", ["reality"]),
        ],
    },
    {
        "id": "memory_learning",
        "label": "память и обучение",
        "summary": "hippocampus, recall, semantic memory, consolidation и обучение на опыте",
        "nodes": [
            ("hippocampus", "hippocampus", ["sqlite_memory"]),
            ("keyword_recall", "keyword recall", ["поиск по словам"]),
            ("semantic_recall", "semantic recall", ["vector_memory"]),
            ("vector_memory", "vector memory", ["embedding"]),
            ("memory_importance", "важность памяти", ["importance"]),
            ("consolidated_pattern", "консолидированный паттерн", ["pattern"]),
            ("remember_event", "remember event", ["remember"]),
            ("memory_trace", "след памяти", ["trace"]),
            ("similarity", "похожесть", ["cosine"]),
            ("forgetting_gate", "фильтр лишнего", ["relevance_gate"]),
            ("recall_context", "контекст recall", ["context"]),
            ("learning_signal", "сигнал обучения", ["feedback"]),
            ("critic_memory", "память critic", ["self_evaluation"]),
            ("episodic_memory", "эпизодическая память", ["event_memory"]),
            ("semantic_memory", "смысловая память", ["meaning_memory"]),
            ("pattern_memory", "память паттернов", ["pattern_memory"]),
            ("working_memory_link", "связь с working memory", ["session"]),
            ("outcome_memory", "память результата", ["result_memory"]),
            ("concept_memory", "память концептов", ["concept"]),
            ("memory_health", "здоровье памяти", ["quality"]),
        ],
    },
    {
        "id": "synapse_association",
        "label": "синапсы и ассоциации",
        "summary": "взвешенные связи, evidence, кластеры, мосты и traversal",
        "nodes": [
            ("synapse", "синапс", ["edge"]),
            ("weight", "вес", ["strength"]),
            ("evidence_count", "evidence count", ["repeat"]),
            ("source_node", "source node", ["from"]),
            ("target_node", "target node", ["to"]),
            ("relation_type", "тип связи", ["relation"]),
            ("similar_to", "similar_to", ["similarity_relation"]),
            ("bridges_to", "bridges_to", ["cluster_bridge"]),
            ("contains", "contains", ["membership"]),
            ("grounds", "grounds", ["grounding"]),
            ("activates", "activates", ["activation"]),
            ("cluster", "кластер", ["cluster"]),
            ("node", "узел", ["node"]),
            ("graph_walk", "graph walk", ["traversal"]),
            ("association_density", "плотность связей", ["density"]),
            ("top_synapse", "сильная связь", ["top_edge"]),
            ("repeated_relation", "повторная связь", ["reinforced"]),
            ("weak_relation", "слабая связь", ["weak_edge"]),
            ("bridge_relation", "межкластерный мост", ["bridge"]),
            ("network_growth", "рост сети", ["growth"]),
        ],
    },
    {
        "id": "planning_agency",
        "label": "план и агентность",
        "summary": "цель, следующий шаг, выбор действия, маленькая проверка и автономность",
        "nodes": [
            ("goal", "цель", ["objective"]),
            ("active_goal", "активная цель", ["current_goal"]),
            ("next_action", "следующее действие", ["next_step"]),
            ("planner", "planner", ["plan"]),
            ("priority", "приоритет", ["rank"]),
            ("effort", "усилие", ["cost"]),
            ("expected_result", "ожидаемый результат", ["expected"]),
            ("decision", "решение", ["choice"]),
            ("agency", "агентность", ["autonomy"]),
            ("small_step", "маленький шаг", ["minimal_action"]),
            ("scope", "масштаб", ["size"]),
            ("execution", "исполнение", ["do"]),
            ("task", "задача", ["quest"]),
            ("deadline", "дедлайн", ["time_limit"]),
            ("commitment", "обязательство", ["promise"]),
            ("adjustment", "корректировка", ["adaptation"]),
            ("strategy", "стратегия", ["approach"]),
            ("tactic", "тактика", ["method"]),
            ("autonomy_limit", "граница автономности", ["safety"]),
            ("reality_check", "проверка реальностью", ["verify"]),
        ],
    },
    {
        "id": "action_outcome",
        "label": "действие и результат",
        "summary": "выполнение, успех, провал, частичный результат и подкрепление",
        "nodes": [
            ("action", "действие", ["do"]),
            ("action_done", "действие сделано", ["done"]),
            ("action_skipped", "действие пропущено", ["skipped"]),
            ("success", "успех", ["outcome_success"]),
            ("failure", "провал", ["outcome_failure"]),
            ("partial", "частичный результат", ["outcome_partial"]),
            ("feedback", "обратная связь", ["feedback_loop"]),
            ("reinforcement", "подкрепление", ["reinforce"]),
            ("weaken", "ослабление", ["weaken"]),
            ("result_memory", "память результата", ["outcome_memory"]),
            ("learning_outcome", "обучение результатом", ["learn"]),
            ("measure", "измерение", ["metric"]),
            ("build_result", "результат сборки", ["build"]),
            ("human_result", "живой результат", ["real_world"]),
            ("money_result", "деньги как результат", ["money"]),
            ("creation_result", "созданный результат", ["creation"]),
            ("relationship_result", "результат в отношениях", ["people"]),
            ("body_result", "результат в теле", ["body"]),
            ("adapt_next", "следующая адаптация", ["next_adjustment"]),
            ("done_pattern", "паттерн выполнения", ["execution_pattern"]),
        ],
    },
    {
        "id": "language_meaning",
        "label": "язык и смысл",
        "summary": "слова, фразы, ответы, intent, summary и compression",
        "nodes": [
            ("word", "слово", ["token"]),
            ("phrase", "фраза", ["sentence"]),
            ("meaning", "смысл", ["semantics"]),
            ("intent", "намерение", ["intent"]),
            ("question", "вопрос", ["ask"]),
            ("answer", "ответ", ["reply"]),
            ("summary", "сводка", ["summarize"]),
            ("concept_label", "концепт-ярлык", ["label"]),
            ("compression", "сжатие", ["compress"]),
            ("crystallization", "кристаллизация", ["crystallize"]),
            ("russian", "русский язык", ["ru"]),
            ("english", "английский язык", ["en"]),
            ("debug_text", "debug текст", ["telemetry"]),
            ("public_answer", "человеческий ответ", ["answer_text"]),
            ("tone", "тон", ["style"]),
            ("relevance", "релевантность", ["relevance_gate"]),
            ("capability_question", "вопрос о возможностях", ["what_can_you_do"]),
            ("memory_question", "вопрос о памяти", ["what_do_you_remember"]),
            ("next_question", "вопрос что дальше", ["next"]),
            ("identity_question", "вопрос идентичности", ["who"]),
        ],
    },
    {
        "id": "interface_game",
        "label": "Game UI",
        "summary": "HUD, API bridge, voice, camera, basePath и пользовательский интерфейс",
        "nodes": [
            ("game", "Game", ["personal_os"]),
            ("hud", "HUD", ["interface"]),
            ("api_bridge", "/api/max17", ["bridge"]),
            ("base_path", "basePath /game", ["route"]),
            ("chat_input", "поле ввода", ["input"]),
            ("send_button", "кнопка отправки", ["send"]),
            ("status_indicator", "индикатор Max17", ["status"]),
            ("voice_output", "голосовой вывод", ["speech_synthesis"]),
            ("microphone_input", "голосовой ввод", ["speech_recognition"]),
            ("camera_input", "камера", ["getUserMedia"]),
            ("mobile_layout", "мобильная верстка", ["mobile"]),
            ("scroll", "прокрутка", ["overflow"]),
            ("local_dev", "локальный dev server", ["localhost"]),
            ("network_url", "сетевой адрес", ["phone"]),
            ("secure_context", "защищенный контекст", ["https"]),
            ("browser_permission", "разрешение браузера", ["permission"]),
            ("classic", "classic UI", ["classic"]),
            ("hud_message", "HUD сообщение", ["user_message"]),
            ("system_state", "system state", ["state_event"]),
            ("frontend_helper", "max17-client", ["client"]),
        ],
    },
    {
        "id": "debugging_code",
        "label": "код и отладка",
        "summary": "ошибки, сборка, lint, зависимости, terminal и минимальные исправления",
        "nodes": [
            ("error", "ошибка", ["bug"]),
            ("terminal_error", "terminal error", ["traceback"]),
            ("build", "build", ["npm_run_build"]),
            ("lint", "lint", ["eslint"]),
            ("test", "test", ["smoke"]),
            ("dependency", "зависимость", ["package"]),
            ("numpy", "numpy", ["python_dep"]),
            ("torch", "torch", ["missing_module"]),
            ("npm", "npm", ["node"]),
            ("python", "python", ["python3"]),
            ("sqlite", "SQLite", ["db"]),
            ("nextjs", "Next.js", ["next"]),
            ("react", "React", ["component"]),
            ("typescript", "TypeScript", ["ts"]),
            ("route", "route", ["api"]),
            ("process", "process", ["child_process"]),
            ("log", "лог", ["console"]),
            ("minimal_fix", "минимальный фикс", ["safe_fix"]),
            ("regression", "регрессия", ["breakage"]),
            ("verification", "проверка", ["verify"]),
        ],
    },
    {
        "id": "time_rhythm",
        "label": "время и ритм",
        "summary": "сессия, сон, дедлайн, повторение, цикл и обновление",
        "nodes": [
            ("time", "время", ["clock"]),
            ("session", "сессия", ["current_session"]),
            ("recent_turn", "последний ход", ["turn"]),
            ("sleep_mode", "sleep mode", ["consolidation"]),
            ("deadline", "дедлайн", ["due"]),
            ("morning", "утро", ["am"]),
            ("night", "ночь", ["pm"]),
            ("repeat", "повторение", ["again"]),
            ("interval", "интервал", ["period"]),
            ("cycle", "цикл", ["loop"]),
            ("freshness", "свежесть", ["recency"]),
            ("last_used", "last_used", ["used"]),
            ("created_at", "created_at", ["created"]),
            ("updated_at", "updated_at", ["updated"]),
            ("daily_pattern", "дневной паттерн", ["day_pattern"]),
            ("rest", "восстановление", ["recover"]),
            ("momentum", "инерция", ["flow"]),
            ("pause", "пауза", ["break"]),
            ("start", "старт", ["begin"]),
            ("finish", "финиш", ["end"]),
        ],
    },
    {
        "id": "emotion_motivation",
        "label": "эмоции и мотивация",
        "summary": "интерес, усталость, уверенность, тревога, радость и импульс действия",
        "nodes": [
            ("motivation", "мотивация", ["drive"]),
            ("interest", "интерес", ["curiosity"]),
            ("joy", "радость", ["pleasure"]),
            ("fear", "страх", ["anxiety"]),
            ("anger", "злость", ["rage"]),
            ("fatigue", "усталость", ["tired"]),
            ("confidence", "уверенность", ["certainty"]),
            ("doubt", "сомнение", ["uncertainty"]),
            ("calm", "спокойствие", ["calmness"]),
            ("pressure", "давление", ["stress"]),
            ("flow", "поток", ["deep_work"]),
            ("boredom", "скука", ["low_interest"]),
            ("care_emotion", "эмоция заботы", ["care"]),
            ("attachment", "привязанность", ["bond"]),
            ("pride", "гордость", ["achievement"]),
            ("shame", "стыд", ["self_judgment"]),
            ("hope", "надежда", ["future_positive"]),
            ("frustration", "фрустрация", ["blocked"]),
            ("resolve", "решимость", ["commitment"]),
            ("warmth", "тепло отношения", ["social_warmth"]),
        ],
    },
    {
        "id": "values_reality",
        "label": "ценности и реальность",
        "summary": "контакт с телом, работой, деньгами, людьми, честностью и созданным результатом",
        "nodes": [
            ("reality_contact", "контакт с реальностью", ["real_world"]),
            ("body_check", "проверка телом", ["body"]),
            ("work", "работа", ["labor"]),
            ("money", "деньги", ["income"]),
            ("people", "живые люди", ["relationships"]),
            ("creation", "создание", ["make"]),
            ("honesty", "честность", ["truth"]),
            ("anti_escape", "анти-эскапизм", ["not_digital_pacifier"]),
            ("responsibility", "ответственность", ["duty"]),
            ("usefulness", "польза", ["utility"]),
            ("health", "здоровье", ["wellbeing"]),
            ("love", "любовь", ["care"]),
            ("clarity", "ясность", ["understanding"]),
            ("grounding", "заземление", ["ground"]),
            ("result", "результат", ["outcome"]),
            ("action", "действие", ["do"]),
            ("truth_check", "проверка правдой", ["verify"]),
            ("human_first", "человек сначала", ["human"]),
            ("limits", "границы", ["safety"]),
            ("service", "служение", ["help"]),
        ],
    },
    {
        "id": "work_economy",
        "label": "работа и экономика",
        "summary": "проекты, продукт, ценность, деньги, рынок, фокус и доставка результата",
        "nodes": [
            ("project", "проект", ["product"]),
            ("product", "продукт", ["shipping"]),
            ("value", "ценность", ["utility"]),
            ("money", "деньги", ["revenue"]),
            ("market", "рынок", ["customers"]),
            ("skill", "навык", ["capability"]),
            ("focus_work", "рабочий фокус", ["deep_work"]),
            ("delivery", "доставка результата", ["ship"]),
            ("client", "клиент", ["user"]),
            ("automation", "автоматизация", ["system"]),
            ("leverage", "рычаг", ["scale"]),
            ("time_value", "стоимость времени", ["time"]),
            ("priority", "приоритет", ["rank"]),
            ("risk", "риск", ["uncertainty"]),
            ("reward", "награда", ["gain"]),
            ("cost", "стоимость", ["expense"]),
            ("quality", "качество", ["standard"]),
            ("iteration", "итерация", ["cycle"]),
            ("launch", "запуск", ["release"]),
            ("maintenance", "поддержка", ["support"]),
        ],
    },
    {
        "id": "safety_risk",
        "label": "безопасность и риск",
        "summary": "границы, ошибки, приватность, осторожность, доверие и восстановление",
        "nodes": [
            ("safety", "безопасность", ["safe"]),
            ("risk", "риск", ["danger"]),
            ("privacy", "приватность", ["private"]),
            ("permission", "разрешение", ["consent"]),
            ("secure_context", "secure context", ["https"]),
            ("data_boundary", "граница данных", ["data_limit"]),
            ("hallucination", "галлюцинация", ["fake_claim"]),
            ("overreach", "чрезмерность", ["too_much"]),
            ("minimalism", "минимализм", ["simple"]),
            ("rollback", "откат", ["revert"]),
            ("backup", "резерв", ["backup"]),
            ("verification", "верификация", ["check"]),
            ("error_recovery", "восстановление после ошибки", ["recovery"]),
            ("trust", "доверие", ["reliability"]),
            ("human_control", "контроль человека", ["human_in_loop"]),
            ("no_external_api", "без внешнего API", ["local"]),
            ("key_secret", "секретный ключ", ["api_key"]),
            ("device_missing", "устройство не найдено", ["camera_error"]),
            ("not_secure", "не защищённое соединение", ["browser_error"]),
            ("safe_growth", "безопасный рост", ["bounded"]),
        ],
    },
)

CLUSTER_BRIDGES: tuple[tuple[str, str, str], ...] = (
    ("self_identity", "family_social", "самость связывается с происхождением, родителями и доверием"),
    ("family_social", "body_senses", "живая связь проявляется через голос, тепло, касание и присутствие"),
    ("natural_world", "body_senses", "солнце, свет и температура влияют на тело и энергию"),
    ("perception_environment", "natural_world", "камера даёт грубые сигналы о свете, движении и пространстве"),
    ("perception_environment", "memory_learning", "наблюдения среды становятся памятью и recall-контекстом"),
    ("memory_learning", "synapse_association", "память превращается во взвешенные ассоциации"),
    ("synapse_association", "planning_agency", "ассоциации поддерживают планирование и выбор следующего действия"),
    ("planning_agency", "action_outcome", "план должен превращаться в действие и результат"),
    ("action_outcome", "memory_learning", "результат записывается обратно в память"),
    ("language_meaning", "memory_learning", "слова сжимаются в понятия и становятся recall-ключами"),
    ("language_meaning", "interface_game", "ответы и intent проходят через HUD и API bridge"),
    ("interface_game", "perception_environment", "Game даёт Max17 локальные сенсорные события"),
    ("debugging_code", "action_outcome", "отладка проверяется сборкой, тестом и результатом"),
    ("debugging_code", "interface_game", "ошибки UI/API связываются с Game shell"),
    ("time_rhythm", "memory_learning", "сон и повторение консолидируют память"),
    ("time_rhythm", "planning_agency", "дедлайны и ритм влияют на план"),
    ("emotion_motivation", "planning_agency", "мотивация меняет выбор следующего шага"),
    ("emotion_motivation", "body_senses", "эмоции связаны с телесным состоянием"),
    ("values_reality", "action_outcome", "ценности проверяются реальным действием и результатом"),
    ("values_reality", "family_social", "живые люди и любовь являются реальностным якорем"),
    ("work_economy", "action_outcome", "работа проверяется доставленным результатом"),
    ("work_economy", "values_reality", "деньги и продукт возвращают систему к реальности"),
    ("safety_risk", "debugging_code", "безопасность требует проверки ошибок и зависимостей"),
    ("safety_risk", "interface_game", "разрешения, камера и secure context ограничивают UI"),
    ("safety_risk", "values_reality", "границы удерживают систему полезной для человека"),
)


class ClusteredNeuralGraph:
    def __init__(self, synapse_graph: SynapseGraph) -> None:
        self.synapse_graph = synapse_graph
        self._cluster_by_id = {str(cluster["id"]): cluster for cluster in NEURAL_CLUSTERS}
        self._node_index = self._build_node_index()

    def seed(self, *, target_synapses: int = TARGET_NEURAL_SYNAPSES, max_new: int | None = None) -> dict[str, Any]:
        target = max(1, int(target_synapses or TARGET_NEURAL_SYNAPSES))
        before = self._total_synapses()
        missing = max(0, target - before)
        if max_new is not None:
            missing = min(missing, max(0, int(max_new)))
        if missing <= 0:
            return {
                "target_synapses": target,
                "before": before,
                "after": before,
                "created_or_updated": 0,
                "clusters": len(NEURAL_CLUSTERS),
                "cluster_nodes": len(self._node_index),
                "status": "target_already_reached",
            }

        known = self._existing_keys()
        candidates: list[tuple[str, str, str, str, str, float, str]] = []
        for record in self._candidate_records():
            key = record[:5]
            if key in known:
                continue
            known.add(key)
            candidates.append(record)
            if len(candidates) >= missing:
                break

        touched = self._bulk_upsert(candidates)
        after = self._total_synapses()
        return {
            "target_synapses": target,
            "before": before,
            "after": after,
            "created_or_updated": touched,
            "added_synapses": max(0, after - before),
            "remaining_to_target": max(0, target - after),
            "clusters": len(NEURAL_CLUSTERS),
            "cluster_nodes": len(self._node_index),
            "status": "seeded" if after >= target else "seeded_partial",
        }

    def snapshot(self, *, limit: int = 8) -> dict[str, Any]:
        with self.synapse_graph._conn() as c:
            totals = c.execute(
                """
                SELECT
                    COUNT(*) AS total_neural_edges,
                    COALESCE(AVG(weight), 0) AS avg_weight,
                    COALESCE(MAX(weight), 0) AS max_weight
                FROM synapses
                WHERE source_type LIKE 'neural_%' OR target_type LIKE 'neural_%'
                """
            ).fetchone()
            cluster_rows = c.execute(
                """
                SELECT source_id AS cluster_id, COUNT(*) AS count
                FROM synapses
                WHERE source_type = 'neural_cluster'
                GROUP BY source_id
                ORDER BY count DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            bridge_rows = c.execute(
                """
                SELECT *
                FROM synapses
                WHERE relation_type = 'bridges_to'
                ORDER BY weight DESC, evidence_count DESC, updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        return {
            "target_synapses": TARGET_NEURAL_SYNAPSES,
            "total_neural_edges": int(totals["total_neural_edges"]),
            "avg_neural_weight": round(float(totals["avg_weight"]), 4),
            "max_neural_weight": round(float(totals["max_weight"]), 4),
            "clusters": len(NEURAL_CLUSTERS),
            "cluster_nodes": len(self._node_index),
            "top_clusters": [
                {
                    "cluster_id": str(row["cluster_id"]),
                    "label": self._cluster_label(str(row["cluster_id"])),
                    "edges": int(row["count"]),
                }
                for row in cluster_rows
            ],
            "top_bridges": [self.synapse_graph._row_to_dict(row) for row in bridge_rows],
        }

    def walk(self, query: str, *, steps: int = 8) -> dict[str, Any]:
        start = self._resolve_start(query)
        path: list[dict[str, Any]] = []
        visited = {(start["type"], start["id"])}
        current_type = start["type"]
        current_id = start["id"]
        steps = max(1, min(16, int(steps or 8)))

        with self.synapse_graph._conn() as c:
            for _ in range(steps):
                row = self._next_edge(c, current_type, current_id, visited)
                if row is None:
                    break
                edge = self.synapse_graph._row_to_dict(row)
                edge["from_label"] = self._label_for(edge["source_type"], edge["source_id"])
                edge["to_label"] = self._label_for(edge["target_type"], edge["target_id"])
                path.append(edge)
                current_type = str(row["target_type"])
                current_id = str(row["target_id"])
                visited.add((current_type, current_id))

        visited_clusters: list[str] = []
        for item in [start, *path]:
            for raw in (item.get("id"), item.get("source_id"), item.get("target_id")):
                cluster_id = self._cluster_from_node(str(raw or ""))
                if cluster_id and cluster_id not in visited_clusters:
                    visited_clusters.append(cluster_id)

        return {
            "query": query,
            "start": start,
            "steps": path,
            "visited_clusters": [
                {
                    "cluster_id": cluster_id,
                    "label": self._cluster_label(cluster_id),
                }
                for cluster_id in visited_clusters
            ],
            "status": "walked" if path else "no_seeded_path",
        }

    def _candidate_records(self) -> Iterable[tuple[str, str, str, str, str, float, str]]:
        now = time.time()

        for cluster in NEURAL_CLUSTERS:
            cluster_id = str(cluster["id"])
            cluster_label = str(cluster["label"])
            yield (
                "neural_cluster",
                cluster_id,
                "neural_summary",
                cluster_id,
                "contains",
                0.82,
                _json(
                    {
                        "summary": str(cluster["summary"]),
                        "source": "neural_graph_seed_v0",
                        "cluster": cluster_id,
                        "created_seed_at": now,
                    }
                ),
            )
            for node in cluster["nodes"]:
                node_id, label, aliases = self._node_parts(cluster_id, node)
                yield (
                    "neural_cluster",
                    cluster_id,
                    "neural_node",
                    node_id,
                    "contains",
                    0.76,
                    _json(
                        {
                            "summary": f"{cluster_label} contains {label}",
                            "source": "neural_graph_seed_v0",
                            "cluster": cluster_id,
                            "node_label": label,
                            "aliases": aliases,
                        }
                    ),
                )
                yield (
                    "neural_node",
                    node_id,
                    "neural_cluster",
                    cluster_id,
                    "related_to",
                    0.58,
                    _json(
                        {
                            "summary": f"{label} belongs to cluster {cluster_label}",
                            "source": "neural_graph_seed_v0",
                            "cluster": cluster_id,
                        }
                    ),
                )

        strong_pairs = {(source, target): summary for source, target, summary in CLUSTER_BRIDGES}
        for source, target, summary in CLUSTER_BRIDGES:
            yield (
                "neural_cluster",
                source,
                "neural_cluster",
                target,
                "bridges_to",
                0.74,
                _json(
                    {
                        "summary": summary,
                        "source": "neural_graph_seed_v0",
                        "source_cluster": source,
                        "target_cluster": target,
                    }
                ),
            )
            yield (
                "neural_cluster",
                target,
                "neural_cluster",
                source,
                "bridges_to",
                0.62,
                _json(
                    {
                        "summary": f"reverse bridge: {summary}",
                        "source": "neural_graph_seed_v0",
                        "source_cluster": target,
                        "target_cluster": source,
                    }
                ),
            )

        for cluster in NEURAL_CLUSTERS:
            cluster_id = str(cluster["id"])
            nodes = [self._node_parts(cluster_id, node) for node in cluster["nodes"]]
            for source_id, source_label, _ in nodes:
                for target_id, target_label, _ in nodes:
                    if source_id == target_id:
                        continue
                    jitter = _stable_fraction(source_id, target_id)
                    yield (
                        "neural_node",
                        source_id,
                        "neural_node",
                        target_id,
                        "similar_to",
                        0.46 + jitter * 0.16,
                        _json(
                            {
                                "summary": f"{source_label} связано внутри кластера с {target_label}",
                                "source": "neural_graph_seed_v0",
                                "cluster": cluster_id,
                            }
                        ),
                    )

        clusters = list(NEURAL_CLUSTERS)
        for source_cluster in clusters:
            source_id = str(source_cluster["id"])
            source_nodes = [self._node_parts(source_id, node) for node in source_cluster["nodes"]]
            for target_cluster in clusters:
                target_id = str(target_cluster["id"])
                if source_id == target_id:
                    continue
                target_nodes = [self._node_parts(target_id, node) for node in target_cluster["nodes"]]
                bridge_summary = strong_pairs.get((source_id, target_id))
                base_weight = 0.38 if bridge_summary else 0.24
                for source_node_id, source_label, _ in source_nodes:
                    for target_node_id, target_label, _ in target_nodes:
                        jitter = _stable_fraction(source_node_id, target_node_id)
                        relation = "bridges_to" if bridge_summary else "related_to"
                        yield (
                            "neural_node",
                            source_node_id,
                            "neural_node",
                            target_node_id,
                            relation,
                            _clamp(base_weight + jitter * 0.08),
                            _json(
                                {
                                    "summary": (
                                        bridge_summary
                                        or f"{source_label} может активировать дальний контекст {target_label}"
                                    ),
                                    "source": "neural_graph_seed_v0",
                                    "source_cluster": source_id,
                                    "target_cluster": target_id,
                                }
                            ),
                        )

    def _bulk_upsert(self, records: list[tuple[str, str, str, str, str, float, str]]) -> int:
        if not records:
            return 0
        now = time.time()
        rows = [
            (
                source_type,
                source_id,
                target_type,
                target_id,
                relation_type,
                _clamp(float(weight)),
                now,
                now,
                now,
                metadata_json,
            )
            for source_type, source_id, target_type, target_id, relation_type, weight, metadata_json in records
        ]
        with self.synapse_graph._conn() as c:
            c.executemany(
                """
                INSERT INTO synapses
                (source_type, source_id, target_type, target_id, relation_type, weight,
                 evidence_count, last_used, created_at, updated_at, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
                ON CONFLICT(source_type, source_id, target_type, target_id, relation_type)
                DO UPDATE SET
                    weight = MAX(synapses.weight, excluded.weight),
                    evidence_count = synapses.evidence_count + 1,
                    last_used = excluded.last_used,
                    updated_at = excluded.updated_at,
                    metadata_json = excluded.metadata_json
                """,
                rows,
            )
        return len(rows)

    def _existing_keys(self) -> set[tuple[str, str, str, str, str]]:
        with self.synapse_graph._conn() as c:
            rows = c.execute(
                """
                SELECT source_type, source_id, target_type, target_id, relation_type
                FROM synapses
                """
            ).fetchall()
        return {
            (
                str(row["source_type"]),
                str(row["source_id"]),
                str(row["target_type"]),
                str(row["target_id"]),
                str(row["relation_type"]),
            )
            for row in rows
        }

    def _total_synapses(self) -> int:
        with self.synapse_graph._conn() as c:
            return int(c.execute("SELECT COUNT(*) FROM synapses").fetchone()[0])

    def _next_edge(
        self,
        conn: sqlite3.Connection,
        current_type: str,
        current_id: str,
        visited: set[tuple[str, str]],
    ) -> sqlite3.Row | None:
        rows = conn.execute(
            """
            SELECT *
            FROM synapses
            WHERE source_type = ? AND source_id = ?
            ORDER BY
                CASE
                    WHEN source_type = 'neural_cluster' AND target_type = 'neural_cluster' THEN 0
                    WHEN relation_type = 'bridges_to' THEN 1
                    WHEN target_type = 'neural_cluster' THEN 2
                    WHEN relation_type = 'contains' THEN 3
                    ELSE 4
                END,
                weight DESC,
                evidence_count DESC,
                updated_at DESC
            LIMIT 24
            """,
            (current_type, current_id),
        ).fetchall()
        for row in rows:
            key = (str(row["target_type"]), str(row["target_id"]))
            if key not in visited:
                return row
        return None

    def _resolve_start(self, query: str) -> dict[str, str]:
        normalized = _normalize(query)
        tokens = set(normalized.split())
        best_score = -1
        best_node = next(iter(self._node_index.values()))
        for node in self._node_index.values():
            haystack = set(_normalize(" ".join([node["id"], node["label"], *node["aliases"]])).split())
            score = len(tokens & haystack)
            if normalized and normalized in _normalize(" ".join([node["label"], *node["aliases"]])):
                score += 3
            if score > best_score:
                best_score = score
                best_node = node
        return {
            "type": "neural_node",
            "id": best_node["id"],
            "label": best_node["label"],
            "cluster_id": best_node["cluster_id"],
            "cluster_label": self._cluster_label(best_node["cluster_id"]),
        }

    def _build_node_index(self) -> dict[str, dict[str, Any]]:
        index: dict[str, dict[str, Any]] = {}
        for cluster in NEURAL_CLUSTERS:
            cluster_id = str(cluster["id"])
            for node in cluster["nodes"]:
                node_id, label, aliases = self._node_parts(cluster_id, node)
                index[node_id] = {
                    "id": node_id,
                    "label": label,
                    "aliases": aliases,
                    "cluster_id": cluster_id,
                }
        return index

    def _node_parts(self, cluster_id: str, node: tuple[Any, ...]) -> tuple[str, str, list[str]]:
        local_id = str(node[0])
        label = str(node[1])
        aliases = [str(item) for item in (node[2] if len(node) > 2 else [])]
        return f"{cluster_id}:{local_id}", label, aliases

    def _cluster_label(self, cluster_id: str) -> str:
        cluster = self._cluster_by_id.get(cluster_id)
        return str(cluster.get("label") if cluster else cluster_id)

    def _cluster_from_node(self, node_id: str) -> str:
        if ":" in node_id:
            cluster_id = node_id.split(":", 1)[0]
            return cluster_id if cluster_id in self._cluster_by_id else ""
        return node_id if node_id in self._cluster_by_id else ""

    def _label_for(self, node_type: str, node_id: str) -> str:
        if node_type == "neural_cluster":
            return self._cluster_label(node_id)
        node = self._node_index.get(node_id)
        if node:
            return str(node["label"])
        return Path(str(node_id)).name or str(node_id)

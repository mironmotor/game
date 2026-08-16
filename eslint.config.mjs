import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([
  {
    extends: [...next],
  },
  {
    /**
     * Режимы, перенесённые из ветки main.
     *
     * Они писались под прежние правила React и используют два приёма, которые
     * новый компилятор считает подозрительными: чтение ref в теле компонента и
     * setState внутри эффекта. В этих файлах оба намеренны — так читают
     * localStorage и опрашивают ядро после монтирования, а ref держит
     * состояние анимации, чтобы кадр не перезапускался на каждый рендер.
     *
     * Переписывать чужой рабочий код ради формальности рискованнее, чем
     * ослабить правило точечно: список закрытый, и всё, что вне его, проверяется
     * строго. Когда режимы дойдут до переработки — исключение снимется.
     */
    files: [
      'components/agent/**',
      'components/autoplan/**',
      'components/efir/**',
      'components/maxgraph/**',
      'components/mind/**',
      'components/modes/**',
      'components/quantum/**',
      'components/telegram/**',
      'components/vision/**',
      'components/hud/GlassesHud.tsx',
      'components/hud/QuantumEyes.tsx',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
    },
  },
]);

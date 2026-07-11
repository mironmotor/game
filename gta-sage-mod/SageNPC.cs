// =============================================================================
//  Мудрец из особняка — GTA IV NPC на ядре MAX  (Уровень 2)
//  ScriptHookDotNet (HazardX, namespace GTA). .NET Framework 4.0.
//
//  Что делает:
//    • F9 — призвать Мудреца рядом (старик в костюме, стоит, смотрит на тебя).
//    • Подойди (≤3.5 м) и нажми E → открывается консоль с «sage ».
//    • Набери вопрос → Enter. Команда `sage <вопрос>` уходит в ядро MAX
//      (HTTP POST localhost:3000/game/api/max17, persona=sage, с памятью).
//    • Ответ Мудреца показывается субтитром + в консоли.
//
//  HTTP идёт на ФОНОВОМ потоке (игра не фризится); ответ забирается на Tick
//  (все вызовы GTA-API — строго на игровом потоке).
//
//  Сборка: ссылки на ScriptHookDotNet.dll, System, System.Net,
//  System.Windows.Forms. Выход назвать СТРОГО *.net.dll и положить в scripts\.
// =============================================================================

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using GTA;

namespace SageMansion
{
    public class SageNPC : Script
    {
        // ----------------------------- конфиг ------------------------------
        const string MAX_URL    = "http://localhost:3000/game/api/max17";
        const string SAGE_MODEL = "M_O_SUITED";   // старик в костюме (валидно для GTA IV)
        const int    TIMEOUT_MS = 90000;          // как WARM-таймаут моста MAX
        const float  TALK_DIST  = 3.5f;
        static readonly Keys SPAWN_KEY = Keys.F9;  // призвать
        static readonly Keys TALK_KEY  = Keys.E;   // заговорить (когда рядом)

        // ----------------------------- состояние ---------------------------
        Ped _sage;
        volatile bool _busy;            // запрос в полёте
        volatile string _pendingReply;  // worker → Tick
        bool _hintShown;                // подсказка показана при входе в радиус

        public SageNPC()
        {
            Interval = 150;
            this.Tick    += new EventHandler(OnTick);
            this.KeyDown += new GTA.KeyEventHandler(OnKeyDown);
            BindConsoleCommand("sage", new ConsoleCommandDelegate(OnSageCommand),
                               "Спросить Мудреца:  sage <вопрос>");
        }

        // ------------------------------ ввод -------------------------------
        void OnKeyDown(object sender, GTA.KeyEventArgs e)
        {
            if (e.Key == SPAWN_KEY)
                SpawnSage();
            else if (e.Key == TALK_KEY && NearSage() && !_busy)
                Game.Console.Open("sage ");   // открыть консоль с готовым префиксом
        }

        void OnSageCommand(object sender, ConsoleEventArgs e)
        {
            if (_busy) { Game.Console.Print("Мудрец ещё размышляет..."); return; }
            string question = JoinParams(e);
            if (question.Length == 0) { Game.Console.Print("Скажи что-нибудь: sage <вопрос>"); return; }
            Ask(question);
        }

        // собрать вопрос из всех параметров консоли (защитно, без бесконечного цикла)
        static string JoinParams(ConsoleEventArgs e)
        {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 128; i++)
            {
                string p;
                try { p = e.Parameter(i); } catch { break; }
                if (string.IsNullOrEmpty(p)) break;
                if (sb.Length > 0) sb.Append(' ');
                sb.Append(p);
            }
            return sb.ToString().Trim();
        }

        // ------------------------------ спавн ------------------------------
        void SpawnSage()
        {
            if (Exists(_sage)) { try { _sage.Delete(); } catch { } }
            Vector3 spot = Player.Character.Position.Around(2.0f);
            _sage = World.CreatePed(SAGE_MODEL, spot);
            if (Exists(_sage))
            {
                _sage.CurrentRoom = Player.Character.CurrentRoom;  // виден в помещении
                _sage.BlockPermanentEvents = true;                 // не убегает, не реагирует
                _sage.Invincible = true;
                _sage.Task.AlwaysKeepTask = true;
                _sage.Task.StandStill(-1);
                _sage.Task.TurnTo(Player.Character);
                _hintShown = false;
                Game.DisplayText("Мудрец явился. Подойди и нажми E.", 5000);
            }
            else
            {
                Game.DisplayText("Не удалось призвать Мудреца.", 3000);
            }
        }

        bool NearSage()
        {
            return Exists(_sage) &&
                   Player.Character.Position.DistanceTo(_sage.Position) <= TALK_DIST;
        }

        // ------------------------- запрос к ядру MAX -----------------------
        void Ask(string question)
        {
            _busy = true;
            Game.DisplayText("Мудрец размышляет...", 2000);
            if (Exists(_sage)) { try { _sage.Task.TurnTo(Player.Character); } catch { } }

            Thread worker = new Thread(delegate()
            {
                string reply;
                try { reply = CallMax(question); }
                catch (Exception ex) { reply = "(Мудрец молчит: " + ex.Message + ")"; }
                _pendingReply = (reply == null || reply.Length == 0)
                    ? "(Мудрец задумался и не ответил)" : reply;
                _busy = false;
            });
            worker.IsBackground = true;
            worker.Start();
        }

        static string CallMax(string question)
        {
            string body = "{\"type\":\"user_message\",\"message\":\""
                          + JsonEscape(question) + "\",\"persona\":\"sage\"}";
            byte[] data = Encoding.UTF8.GetBytes(body);

            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(MAX_URL);
            req.Method = "POST";
            req.ContentType = "application/json";
            req.Timeout = TIMEOUT_MS;
            req.ReadWriteTimeout = TIMEOUT_MS;
            req.ContentLength = data.Length;
            using (Stream s = req.GetRequestStream()) { s.Write(data, 0, data.Length); }

            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
            {
                string json = sr.ReadToEnd();
                return ExtractAnswerText(json);
            }
        }

        // ------------------------------- Tick ------------------------------
        void OnTick(object sender, EventArgs e)
        {
            string reply = _pendingReply;
            if (reply != null)
            {
                _pendingReply = null;
                Game.Console.Print("Мудрец: " + reply);
                Game.DisplayText(reply, 9000);   // безопасно: мы на игровом потоке
            }

            // подсказка при входе в радиус (один раз, пока не отойдёшь)
            if (NearSage())
            {
                if (!_hintShown && !_busy)
                {
                    Game.DisplayText("Нажми E — заговорить с Мудрецом.", 2500);
                    _hintShown = true;
                }
            }
            else _hintShown = false;
        }

        // --------------------------- JSON-утилиты --------------------------
        static string JsonEscape(string s)
        {
            StringBuilder sb = new StringBuilder();
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"':  sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n");  break;
                    case '\r': sb.Append("\\r");  break;
                    case '\t': sb.Append("\\t");  break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        // Достаём answer.text без сторонних JSON-библиотек (надёжнее под Wine .NET):
        // ищем "answer", затем первый "text":"..." и снимаем escape.
        static string ExtractAnswerText(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            int a = json.IndexOf("\"answer\"");
            int from = a >= 0 ? a : 0;
            int t = json.IndexOf("\"text\"", from);
            if (t < 0) return null;
            int colon = json.IndexOf(':', t);
            if (colon < 0) return null;
            int q = json.IndexOf('"', colon + 1);
            if (q < 0) return null;

            StringBuilder sb = new StringBuilder();
            for (int i = q + 1; i < json.Length; i++)
            {
                char c = json[i];
                if (c == '\\' && i + 1 < json.Length)
                {
                    char n = json[++i];
                    switch (n)
                    {
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case '"': sb.Append('"');  break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/');  break;
                        case 'u':
                            if (i + 4 < json.Length)
                            {
                                int code = Convert.ToInt32(json.Substring(i + 1, 4), 16);
                                sb.Append((char)code);
                                i += 4;
                            }
                            break;
                        default: sb.Append(n); break;
                    }
                }
                else if (c == '"') break;   // конец строки
                else sb.Append(c);
            }
            return sb.ToString();
        }
    }
}

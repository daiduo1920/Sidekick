using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace KuroDesk
{
    /// <summary>
    /// Privacy-safe global keyboard & mouse hook.
    /// Hook callbacks NEVER perform blocking IPC or COM work — they only push lightweight structs into a queue
    /// drained on the UI timer, preventing Windows LowLevelHooksTimeout silent uninstall.
    /// Maps exact 5-row 65% QWERTY spatial slots + shortcut meme triggers + self-healing stuck-key pruning.
    /// </summary>
    internal sealed class GlobalInputHook : IDisposable
    {
        public struct KeySlot
        {
            public int Row;
            public int Col;
            public int Hand;
            public int Kind; // 0=normal, 1=accent, 2=spacebar

            public KeySlot(int row, int col, int hand, int kind)
            {
                Row = row; Col = col; Hand = hand; Kind = kind;
            }
        }

        private enum QueuedKind { Key, Meme, MouseButton, MouseWheel }

        private struct QueuedEvent
        {
            public QueuedKind EventKind;
            public int A, B, C, D, E;
            public bool Flag;
            public string Text;
        }

        public event Action<int, int, int, int, int, bool> OnKeySlotEvent; // row, col, hand, kind, vk, isDown
        public event Action<string> OnShortcutMeme;                   // "undo_panic" | "save_zen" | "cv_flurry" | "enter_slam"
        public event Action<int, int> OnMouseMove;                    // screenX, screenY
        public event Action<int, bool, int, int> OnMouseButton;       // btn, isDown, screenX, screenY
        public event Action<int> OnMouseWheel;                        // delta

        public bool IsKeyboardHookActive { get { return _kbHook != IntPtr.Zero; } }
        public bool IsMouseHookActive { get { return _msHook != IntPtr.Zero; } }

        private IntPtr _kbHook = IntPtr.Zero;
        private IntPtr _msHook = IntPtr.Zero;
        private Win32Native.LowLevelHookProc _kbProc;
        private Win32Native.LowLevelHookProc _msProc;

        private readonly Dictionary<uint, KeySlot> _vkMap = new Dictionary<uint, KeySlot>();
        private readonly Dictionary<uint, long> _pressedVks = new Dictionary<uint, long>();
        private readonly Queue<QueuedEvent> _queue = new Queue<QueuedEvent>(64);
        private readonly object _queueLock = new object();
        private readonly Stopwatch _sw = Stopwatch.StartNew();

        // Coalesced latest cursor position
        private volatile int _lastMouseX;
        private volatile int _lastMouseY;
        private volatile bool _mouseMoved;

        // Meme burst trackers (timestamps in ms)
        private readonly Queue<long> _undoTimes = new Queue<long>();
        private long _lastCopyMs = -99999;
        private long _lastCvMs = -99999;
        private int _cvCount = 0;
        private long _lastSaveMs = -99999;
        private long _lastEnterMs = -99999;
        private long _lastPruneMs = 0;

        private bool _disposed;

        public GlobalInputHook()
        {
            BuildSpatialKeyMap();
        }

        public void Start()
        {
            _kbProc = KeyboardHookCallback;
            _msProc = MouseHookCallback;
            IntPtr hMod = Win32Native.GetModuleHandle(null);
            _kbHook = Win32Native.SetWindowsHookEx(Win32Native.WH_KEYBOARD_LL, _kbProc, hMod, 0);
            _msHook = Win32Native.SetWindowsHookEx(Win32Native.WH_MOUSE_LL, _msProc, hMod, 0);
        }

        /// <summary>
        /// Called on the UI thread (16ms frame tick) to dispatch queued hook events safely outside the OS hook callback
        /// and self-heal any keys whose WM_KEYUP was dropped across elevated (UAC/Admin) windows.
        /// </summary>
        public void DrainEvents()
        {
            if (_mouseMoved)
            {
                _mouseMoved = false;
                Action<int, int> move = OnMouseMove;
                if (move != null) move(_lastMouseX, _lastMouseY);
            }

            // Periodically prune keys stuck from UIPI/Admin window focus switches (every 500ms)
            long now = _sw.ElapsedMilliseconds;
            if (now - _lastPruneMs > 500)
            {
                _lastPruneMs = now;
                List<uint> stale = null;
                lock (_queueLock)
                {
                    foreach (KeyValuePair<uint, long> kv in _pressedVks)
                    {
                        if (now - kv.Value > 1000 && (Win32Native.GetAsyncKeyState((int)kv.Key) & 0x8000) == 0)
                        {
                            if (stale == null) stale = new List<uint>();
                            stale.Add(kv.Key);
                        }
                    }
                    if (stale != null)
                    {
                        foreach (uint vk in stale)
                        {
                            _pressedVks.Remove(vk);
                            KeySlot slot = ResolveSlot(vk);
                            _queue.Enqueue(new QueuedEvent
                            {
                                EventKind = QueuedKind.Key,
                                A = slot.Row, B = slot.Col, C = slot.Hand, D = slot.Kind, E = (int)vk, Flag = false
                            });
                        }
                    }
                }
            }

            List<QueuedEvent> batch = null;
            lock (_queueLock)
            {
                if (_queue.Count > 0)
                {
                    batch = new List<QueuedEvent>(_queue.Count);
                    while (_queue.Count > 0) batch.Add(_queue.Dequeue());
                }
            }

            if (batch == null) return;
            for (int i = 0; i < batch.Count; i++)
            {
                QueuedEvent ev = batch[i];
                if (ev.EventKind == QueuedKind.Key)
                {
                    Action<int, int, int, int, int, bool> h = OnKeySlotEvent;
                    if (h != null) h(ev.A, ev.B, ev.C, ev.D, ev.E, ev.Flag);
                }
                else if (ev.EventKind == QueuedKind.Meme)
                {
                    Action<string> h = OnShortcutMeme;
                    if (h != null) h(ev.Text);
                }
                else if (ev.EventKind == QueuedKind.MouseButton)
                {
                    Action<int, bool, int, int> h = OnMouseButton;
                    if (h != null) h(ev.A, ev.Flag, ev.B, ev.C);
                }
                else if (ev.EventKind == QueuedKind.MouseWheel)
                {
                    Action<int> h = OnMouseWheel;
                    if (h != null) h(ev.A);
                }
            }
        }

        private void Enqueue(QueuedEvent ev)
        {
            lock (_queueLock)
            {
                if (_queue.Count > 256) _queue.Dequeue();
                _queue.Enqueue(ev);
            }
        }

        private IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int msg = wParam.ToInt32();
                bool isDown = (msg == Win32Native.WM_KEYDOWN || msg == Win32Native.WM_SYSKEYDOWN);
                bool isUp = (msg == Win32Native.WM_KEYUP || msg == Win32Native.WM_SYSKEYUP);
                if (isDown || isUp)
                {
                    Win32Native.KBDLLHOOKSTRUCT info = (Win32Native.KBDLLHOOKSTRUCT)
                        Marshal.PtrToStructure(lParam, typeof(Win32Native.KBDLLHOOKSTRUCT));
                    uint vk = info.vkCode;
                    long now = _sw.ElapsedMilliseconds;

                    bool shouldEmit = false;
                    lock (_queueLock)
                    {
                        if (isDown)
                        {
                            long prevMs;
                            if (!_pressedVks.TryGetValue(vk, out prevMs))
                            {
                                _pressedVks[vk] = now;
                                shouldEmit = true;
                            }
                            else
                            {
                                // Self-heal if previous WM_KEYUP was dropped (gap > 1200ms exceeds Windows repeat delay)
                                if (now - prevMs > 1200) shouldEmit = true;
                                _pressedVks[vk] = now;
                            }
                        }
                        else
                        {
                            _pressedVks.Remove(vk);
                            shouldEmit = true;
                        }
                    }

                    if (shouldEmit)
                    {
                        KeySlot slot = ResolveSlot(vk);
                        Enqueue(new QueuedEvent
                        {
                            EventKind = QueuedKind.Key,
                            A = slot.Row, B = slot.Col, C = slot.Hand, D = slot.Kind, E = (int)vk, Flag = isDown
                        });
                        if (isDown) DetectShortcutMeme(vk, now);
                    }
                }
            }
            return Win32Native.CallNextHookEx(_kbHook, nCode, wParam, lParam);
        }

        private void DetectShortcutMeme(uint vk, long now)
        {
            bool ctrlDown = (Win32Native.GetAsyncKeyState(0x11) & 0x8000) != 0; // VK_CONTROL

            if (ctrlDown && vk == 0x5A) // Ctrl + Z
            {
                _undoTimes.Enqueue(now);
                while (_undoTimes.Count > 0 && now - _undoTimes.Peek() > 2800) _undoTimes.Dequeue();
                if (_undoTimes.Count >= 3)
                {
                    _undoTimes.Clear();
                    EmitMeme("undo_panic");
                }
            }
            else if (ctrlDown && vk == 0x53) // Ctrl + S
            {
                if (now - _lastSaveMs > 900)
                {
                    _lastSaveMs = now;
                    EmitMeme("save_zen");
                }
            }
            else if (ctrlDown && vk == 0x43) // Ctrl + C
            {
                if (now - _lastCvMs > 4000) _cvCount = 0;
                _lastCopyMs = now;
            }
            else if (ctrlDown && vk == 0x56) // Ctrl + V
            {
                bool recentCopy = (now - _lastCopyMs < 3500);
                bool recentPaste = (now - _lastCvMs < 2500);
                if (recentCopy || recentPaste)
                {
                    _cvCount++;
                    _lastCvMs = now;
                    if (_cvCount >= 2)
                    {
                        _cvCount = 0;
                        EmitMeme("cv_flurry");
                    }
                }
                else
                {
                    _cvCount = 0;
                    _lastCvMs = now;
                }
            }
            else if (!ctrlDown && vk == 0x0D) // Enter slam
            {
                if (now - _lastEnterMs > 550)
                {
                    _lastEnterMs = now;
                    EmitMeme("enter_slam");
                }
            }
        }

        private void EmitMeme(string memeId)
        {
            Enqueue(new QueuedEvent { EventKind = QueuedKind.Meme, Text = memeId });
        }

        private IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int msg = wParam.ToInt32();
                Win32Native.MSLLHOOKSTRUCT info = (Win32Native.MSLLHOOKSTRUCT)
                    Marshal.PtrToStructure(lParam, typeof(Win32Native.MSLLHOOKSTRUCT));

                if (msg == Win32Native.WM_MOUSEMOVE)
                {
                    _lastMouseX = info.pt.X;
                    _lastMouseY = info.pt.Y;
                    _mouseMoved = true;
                }
                else if (msg == Win32Native.WM_LBUTTONDOWN || msg == Win32Native.WM_LBUTTONUP)
                {
                    Enqueue(new QueuedEvent { EventKind = QueuedKind.MouseButton, A = 0, B = info.pt.X, C = info.pt.Y, Flag = (msg == Win32Native.WM_LBUTTONDOWN) });
                }
                else if (msg == Win32Native.WM_RBUTTONDOWN || msg == Win32Native.WM_RBUTTONUP)
                {
                    Enqueue(new QueuedEvent { EventKind = QueuedKind.MouseButton, A = 1, B = info.pt.X, C = info.pt.Y, Flag = (msg == Win32Native.WM_RBUTTONDOWN) });
                }
                else if (msg == Win32Native.WM_MBUTTONDOWN || msg == Win32Native.WM_MBUTTONUP)
                {
                    Enqueue(new QueuedEvent { EventKind = QueuedKind.MouseButton, A = 2, B = info.pt.X, C = info.pt.Y, Flag = (msg == Win32Native.WM_MBUTTONDOWN) });
                }
                else if (msg == Win32Native.WM_MOUSEWHEEL)
                {
                    short delta = (short)((info.mouseData >> 16) & 0xFFFF);
                    Enqueue(new QueuedEvent { EventKind = QueuedKind.MouseWheel, A = delta });
                }
            }
            return Win32Native.CallNextHookEx(_msHook, nCode, wParam, lParam);
        }

        private KeySlot ResolveSlot(uint vk)
        {
            KeySlot slot;
            if (_vkMap.TryGetValue(vk, out slot)) return slot;
            int col = (int)(vk % 11);
            int row = (int)((vk / 11) % 4);
            return new KeySlot(row, col, col <= 5 ? 0 : 1, 0);
        }

        /// <summary>
        /// Exact 1-to-1 spatial mapping matching the 5-row 65% QWERTY mechanical keyboard in ui/core/keymap.js:
        /// Row 0 (12 cols): ESC(0), 1..9(1..9), 0(10), Backspace(11)
        /// Row 1 (11 cols): TAB(0), Q..P(1..10)
        /// Row 2 (11 cols): CAPS(0), A..L(1..9), Enter(10)
        /// Row 3 (11 cols): LShift(0), Z..M(1..7), ,(8), .(9), RShift(10)
        /// Row 4 (8  cols): LCtrl(0), Win(1), LAlt(2), Space(3), Fn/RAlt(4), Left(5), Down/Up(6), Right(7)
        /// </summary>
        private void BuildSpatialKeyMap()
        {
            // Row 0: ESC, 1-0, Backspace
            _vkMap[0x1B] = new KeySlot(0, 0, 0, 1);  // ESC
            _vkMap[0xC0] = new KeySlot(0, 0, 0, 1);  // `~
            uint[] nums = { 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x30 };
            for (int i = 0; i < nums.Length; i++)
            {
                int col = i + 1; // 1..10 ('0' gets its own col 10!)
                _vkMap[nums[i]] = new KeySlot(0, col, col <= 5 ? 0 : 1, 0);
            }
            _vkMap[0xBD] = new KeySlot(0, 10, 1, 0); // -
            _vkMap[0xBB] = new KeySlot(0, 11, 1, 0); // =
            _vkMap[0x08] = new KeySlot(0, 11, 1, 1); // Backspace
            _vkMap[0x2E] = new KeySlot(0, 11, 1, 1); // Delete
            for (uint f = 0; f < 12; f++)
            {
                int col = (int)Math.Min(11, f);
                _vkMap[0x70 + f] = new KeySlot(0, col, col <= 5 ? 0 : 1, 0);
            }

            // Row 1: TAB, Q..P
            _vkMap[0x09] = new KeySlot(1, 0, 0, 0);
            uint[] r1 = { 0x51, 0x57, 0x45, 0x52, 0x54, 0x59, 0x55, 0x49, 0x4F, 0x50 };
            for (int i = 0; i < r1.Length; i++) _vkMap[r1[i]] = new KeySlot(1, i + 1, i + 1 <= 5 ? 0 : 1, 0);
            _vkMap[0xDB] = new KeySlot(1, 10, 1, 0); // [
            _vkMap[0xDD] = new KeySlot(1, 10, 1, 0); // ]
            _vkMap[0xDC] = new KeySlot(1, 10, 1, 0); // \

            // Row 2: CAPS, A..L, Enter
            _vkMap[0x14] = new KeySlot(2, 0, 0, 0);
            uint[] r2 = { 0x41, 0x53, 0x44, 0x46, 0x47, 0x48, 0x4A, 0x4B, 0x4C };
            for (int i = 0; i < r2.Length; i++) _vkMap[r2[i]] = new KeySlot(2, i + 1, i + 1 <= 5 ? 0 : 1, 0);
            _vkMap[0xBA] = new KeySlot(2, 9, 1, 0);  // ;
            _vkMap[0xDE] = new KeySlot(2, 9, 1, 0);  // '
            _vkMap[0x0D] = new KeySlot(2, 10, 1, 1); // Enter

            // Row 3: LShift, Z X C V B N M , . RShift
            _vkMap[0xA0] = new KeySlot(3, 0, 0, 1);  // LShift
            _vkMap[0x10] = new KeySlot(3, 0, 0, 1);
            uint[] r3 = { 0x5A, 0x58, 0x43, 0x56, 0x42, 0x4E, 0x4D };
            for (int i = 0; i < r3.Length; i++) _vkMap[r3[i]] = new KeySlot(3, i + 1, i + 1 <= 4 ? 0 : 1, 0);
            _vkMap[0xBC] = new KeySlot(3, 8, 1, 0);  // ,
            _vkMap[0xBE] = new KeySlot(3, 9, 1, 0);  // .
            _vkMap[0xBF] = new KeySlot(3, 10, 1, 0); // /
            _vkMap[0xA1] = new KeySlot(3, 10, 1, 1); // RShift

            // Row 4: LCtrl, Win, LAlt, Space, RAlt/RCtrl, Arrows
            _vkMap[0xA2] = new KeySlot(4, 0, 0, 0);  // LCtrl
            _vkMap[0x11] = new KeySlot(4, 0, 0, 0);
            _vkMap[0x5B] = new KeySlot(4, 1, 0, 0);  // LWin
            _vkMap[0x5C] = new KeySlot(4, 1, 0, 0);  // RWin
            _vkMap[0xA4] = new KeySlot(4, 2, 0, 0);  // LAlt
            _vkMap[0x12] = new KeySlot(4, 2, 0, 0);
            _vkMap[0x20] = new KeySlot(4, 3, 0, 2);  // Spacebar
            _vkMap[0xA5] = new KeySlot(4, 4, 1, 0);  // RAlt
            _vkMap[0xA3] = new KeySlot(4, 4, 1, 0);  // RCtrl
            _vkMap[0x25] = new KeySlot(4, 5, 1, 0);  // Left
            _vkMap[0x26] = new KeySlot(4, 6, 1, 0);  // Up
            _vkMap[0x28] = new KeySlot(4, 6, 1, 0);  // Down
            _vkMap[0x27] = new KeySlot(4, 7, 1, 1);  // Right
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            if (_kbHook != IntPtr.Zero) { Win32Native.UnhookWindowsHookEx(_kbHook); _kbHook = IntPtr.Zero; }
            if (_msHook != IntPtr.Zero) { Win32Native.UnhookWindowsHookEx(_msHook); _msHook = IntPtr.Zero; }
        }
    }
}

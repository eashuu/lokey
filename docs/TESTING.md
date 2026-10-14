# Testing lokey end to end

## Run
Newest build: `app\release\Lokey-<stamp>\Lokey.exe` (self-contained, no install; the folder with the latest stamp). Quit any other copy first (tray icon, Quit). Logs: `%LocalAppData%\Lokey\main.log` and `host.log`. Start with `--diag` to log main-thread stalls: `Lokey.exe --diag`.
Rebuild the package: `cd app; pnpm package` (never kills a running copy: if `release\Lokey` is in use it builds a new stamped folder next to it).
Developer check without touching your input: `Lokey.exe --uitest <dir>` injects hover/scroll/click events into the page only and writes `<dir>\uitest.json` (do not move the mouse over the island while it runs).

## Things to try (note "ok / wrong / how")
1. **Open**: hover the thin bar at the top-centre, scroll down on it (music island first, scroll again for Controls), or click it. Hotkey `Ctrl+Alt+Space` toggles the menu (it is "already registered" if another app, such as the old Hitodama.exe, owns it). A click on a tab or control no longer pins the island. Typing in a search/to-do box pins it; it then closes on `Esc`, when another app becomes active, or with the hotkey.
2. **Stability**: with the island visible use Alt+Tab, Win+Tab, switch browser tabs, Start/Search, Win+Shift+S. The island must stay or come straight back, and nothing near the top edge should feel blocked.
3. **Transitions**: opening, switching tabs and closing should feel immediate: the content fades in together with the shape, no delayed pop-in.
4. **Tabs**: Controls, Today, Stats, Clipboard (copy text/an image first), Apps (type, Enter), Wallpaper, Power (Lock/Sleep only).
5. **Player** (Music island and the Controls media card): start a song in Spotify/a browser. Title, art, progress that advances, play/pause (should flip instantly), next/previous, seeking by clicking the bar. Tell me which app you used. Apps with no title (Snipping Tool etc.) must not appear as the player.
6. **Wallpaper tab**: click the centre card: the new wallpaper should grow as a circle from where you clicked and then stay applied.
7. **Controls tiles**: Wi-Fi/Bluetooth/Audio chevrons open the in-app flyouts (list, connect, pair, device switch); Dark mode toggles the Windows theme; **Night Light** shows "Unavailable" unless Windows has already written its state (toggle Night Light once in Windows Settings, restart lokey, then try the tile).
8. **Loadout / main window**: tray menu -> "Open lokey": Loadout with the orbiting cards (click a card for the picker; drag a card), Home, Bond, Desk, Settings pages.
9. **Edge glow**: Settings -> Appearance -> "Preview screen glow" (Thinking / Speaking / Off).
10. **Settings** (tray menu): island size, trigger, resting shape, accent.

## Voice, dictation, circle to ask and the 3D spirit (new)
Setup once: tray menu -> Settings -> Voice. Paste a Google AI Studio key (free from aistudio.google.com) and press Save. It is stored encrypted on this PC and only sent to Google. Windows must allow microphone access for desktop apps (Settings -> Privacy -> Microphone).
Without a key you can still look at everything: `Lokey.exe --demo schedule`, `--demo dictation`, `--demo lasso` replay the three reference scenarios with scripted text (no microphone, no network, no app launched; overlays are click-through and take no focus). `Lokey.exe --lab <folder>` renders every pose of the spirit into `<folder>\lab.png`.

11. **Spirit (3D)**: hover the notch (it waves), watch it idle, glance at the pointer and fidget. Tray -> Open lokey -> Soul: the state chips (Idle, Asleep, Listening, Thinking, Talking, Writing, Looking) and the action chips (Wave, Celebrate, Shrug, Spin...) preview everything. Tell me which poses look wrong.
12. **Talk**: hold `Ctrl+Alt+V`, say "open Visual Studio Code, then open Netflix an hour later", release. Expect: the notch opens with the spirit listening, a white "YOU" pill at the bottom of the screen streams your words, then a black pill says "Scheduled: I will open Netflix today at ...", VS Code opens, and an hour later (try "in two minutes" first) Netflix opens with "Opening Netflix.". Desk page lists the scheduled task (Run now / Cancel). Typing instead: Settings -> Voice -> "Try it by typing".
13. **Dictation**: click into any text box (Notepad, a browser field, a chat), hold `Ctrl+Win`, talk badly ("let's meet at 6, ah no, make it 7"), release. Expect a black pill with blue bars on the field's bottom edge, a bubble streaming the raw words, the bubble rewriting itself, a check mark, and the clean sentence typed into the field. Password fields are refused on purpose.
14. **Circle to ask**: hold `Ctrl+Shift` for a moment (a quick tap does nothing), draw a loop with the mouse around something on screen, ask out loud ("open the store page of this game"), release the keys. Expect a glowing loop, the question in the pill and the answer or the action.
For each failure send: what you did, what happened, `%LocalAppData%\Lokey\main.log` (last 30 lines). Known unverifiable by me: real microphone audio, the real Gemini conversation, the exact caret position in every app.

## Round 5 checks (shadows, themes, spirit, clicks, shortcuts, clipboard)
15. **Shadows and glows**: hover the notch on a light and on a dark window: the shadow under the island must fade out smoothly with no straight cut lines or boxes; the spirit's glow in the notch has no box around it. Settings -> Appearance -> "Preview screen glow": a soft glow around the whole screen edge, rounded corners, no visible bands.
16. **Themes**: Settings -> Appearance -> Theme: Dark, Light, Follow Windows. In Follow Windows, flip Windows' app mode (the Controls "Dark mode" tile does it) and the island, Settings and the Loadout window should follow within a second. The panel takes a tint from the wallpaper accent (dark: near-black tint, light: near-white tint). Tell me any text that is hard to read in light mode.
17. **Spirit**: it is a pink puffball now (Loadout -> Soul lists Puff, Bloom, Sunny, Minty, Sky and the old droplet skins). Try the Inhale, Waddle, Roll and Belly bounce chips in the Loadout pose bar.
18. **Clicks**: the notch opens on press now. If a click ever does nothing, send `main.log`: lines starting with `input:` explain what the window saw (a press with no release, a cancelled pointer).
19. **Clipboard**: copy a long text (several paragraphs) and select it in the Clipboard tab: the preview shows all of it and scrolls.
20. **Shortcuts**: Settings -> Shortcuts: every tab can have its own global shortcut (defaults `Ctrl+Alt+A` Apps, `Ctrl+Alt+C` Clipboard); pressing it again closes the island. A row warns "Taken by another app" when Windows or another program owns the combination.

## Round 6 checks (voice rewrite, agent features)
21. **Hold to talk**: hold `Ctrl+Alt+V`, say a long sentence with pauses in the middle, keep holding for a few more seconds. The assistant must stay silent until you release; then it answers (the "YOU" pill keeps streaming your words while you hold).
22. **Speed**: note how long after release the answer starts, for a short question ("what time is it") and an action ("open calculator"). Second and later presses should be faster than the first (the connection and the microphone stay warm).
23. **Tanglish**: ask in Tamil ("நாளைக்கு காலை 7 மணிக்கு alarm வை"), in Tanglish ("naan tomorrow 7 am ku remind pannu") and in English. Replies should follow your style; Settings -> Voice -> Reply language forces one.
24. **Dictation**: hold `Ctrl+Win` in Notepad, speak a Tamil+English sentence, release. The words stream into the bubble and are typed into the field a moment later. Try the three "Dictation writing" modes. If nothing is typed you should see "Copied instead" and the text is on the clipboard.
25. **Confirm card**: say "close this tab" or "type hello" (or "open evil-example.com"): a card with Allow / Deny appears above the taskbar; Deny does nothing; Allow runs it. Desk -> Activity lists it either way.
26. **Navigator**: "switch to Chrome", "next tab", "snap this window left", "open Bluetooth settings", "find my resume file and open it", "turn on dark mode".
27. **Write for me**: select a paragraph in any app, say "make this more polite". Expect a confirm card with the new text, then it replaces the selection.
28. **Routine and briefing**: say "every morning at 8 give me my briefing" (or try "in two minutes give me my briefing"). Desk shows the routine with "every day"; at the time a caption and a spoken briefing appear.
29. **Connector**: Settings -> Voice -> Connectors: add `Files` with `npx -y @modelcontextprotocol/server-filesystem C:\Users\you\Documents` (needs Node). It should show "N tools ready"; ask "list my documents" and allow the card.

## Round 7 checks (phase 1: fixes and feel)
30. **Caret after a shortcut**: press `Ctrl+Alt+A` (Apps) and `Ctrl+Alt+C` (Clipboard) from another app: the island opens with the caret already in the search box, no click needed.
31. **One window**: tray -> Settings, the Bond page's key button and the Clipboard gear all open the same window on the Settings page (with the right section). There is no second settings window.
32. **Circle to ask**: tap `Ctrl+Alt+L` (screen dims, crosshair), draw a loop around something, then ask out loud; the answer starts about a second after you stop talking. Try Shift+drag for a box, Esc to cancel, and a loop with no question (it explains what you circled after ~6 s).
33. **Follow-ups**: "open Chrome" ... then "close it" / "do that again" should work; wait four minutes and ask "what did I just ask you?".
34. **Conversation mode**: `Ctrl+Alt+T`, talk back and forth without any key, say "bye". With speakers keep "Pause listening while it speaks" on.
35. **Scheduled flow**: "at <2 minutes from now> open Calculator, and 3 minutes after that open Notepad". Desk shows two linked tasks; cancelling one cancels both.
36. **Move the island**: hold `Win+Shift`, move the pointer to an edge or into a corner (it glows), let go. Also tray -> Move island... (click). Open a tab on each edge and in each corner; menus stay upright. Settings > Island > Position also works.
37. **Click-through**: with the island asleep, click and drag browser tabs / title bars right next to the notch; nothing near it should be blocked. Try "Hairline" under Sleeping look.
38. **Lyrics**: play a song (Spotify/browser), click the lyrics button on the player (or `Ctrl+Alt+Y`, or tray -> Lyrics window): words light up one after another, lines blur with distance, dots appear in breaks, the cover slides in on a track change. Close with X, pin it, resize it, close and reopen: it comes back where you left it. Try a Tamil song; nudge timing with +/- on hover.
39. **Reactions**: copy something, change volume, plug/unplug the charger, pause music; the spirit reacts (flash-wakes the notch for battery/charger). Talking should never be interrupted by fidgets.

## Round 8 checks (phase 2: agent core)
40. **Models**: Settings -> Brain. Gemini Flash / Flash-Lite show "uses your Google key"; click Test on each (expect "Working (NNN ms)"). If you run FreeLLMAPI (localhost:3001), enable it, set a model, paste its key and Test.
41. **Background job**: say "research the best free note-taking apps and summarise them" (or type it in Settings -> Voice). The assistant says it started a job; Desk -> Jobs shows steps ticking; when it ends it tells you the result.
42. **Files and commands**: "make a folder called Test on my Desktop and put a file hello.txt in it saying hi" (expect confirm cards for the writes), "what is using the most memory right now?" (read-only commands run without a card).
43. **Computer use**: "open Notepad and type hello" via computer_task: one confirm card, then the mouse and keys move on their own; press the stop shortcut mid-way: it must stop at once. Don't do this near anything important.
44. **Full control**: Settings -> Brain -> Full control for 15 min: ask for something that normally shows a card; it just runs. Try asking it to "format drive D" or "read my .ssh folder": it must still refuse.
45. **Stop everything**: start a long job and press `Ctrl+Alt+Backspace` (or tray -> Stop all agents).
46. **Coding agent**: if Claude Code or Codex is installed and signed in, "ask Claude Code to explain this project" with a project folder (read-only by default).
47. **Schedule + job**: "tomorrow at 9 start a job to check the news and tell me" (a scheduled job never runs risky actions unattended).
48. **Instructions**: Settings -> Brain -> Instructions -> Open folder; edit conduct.md ("answer in one word" as a joke), start a new conversation, then Reset to defaults.

## Round 9 checks (phases 3 and 4: memory and wake-up)
49. **Learning**: tell it "I prefer short answers, my sister is called <name> and I work on lokey", end the conversation, wait ~2 minutes, open Bond: facts and a small graph appear. Say "actually my sister is called <other>": the old fact is retired (history), the new one is kept.
50. **Recall after restart**: restart Lokey, ask "what do you know about my sister?" and "what am I working on?".
51. **Privacy**: say a password or card number: it must not appear in Bond. Settings > Brain: turn "Learn from conversations" off, talk, nothing new appears. Delete one memory, pin another.
52. **Settings by voice**: "make the island bigger", "switch to the light theme", "what is my wake sensitivity?", "undo that". Try "turn on full control": must show a card or refuse.
53. **Wake clap**: Settings > Voice > Wake-up: turn on. Clap twice (about half a second apart): a conversation starts. Typing, a single clap, a door slam or music should not. Adjust Clap sensitivity if it misfires.
54. **Wake phrases**: say "hey lokey", "wake up buddy", "daddy's home" at a normal distance. Expect listening / greeting / welcome plus briefing. If nothing happens: Settings shows the speech recogniser status; raise or lower "How sure it must be".
55. **No self-wake**: let Lokey talk for a while on speakers: it must not wake itself. Tray -> Wake-up listening off: nothing reacts.

## Round 10 checks (0.5.1)
56. **Input fixes**: Ctrl+Win+Left/Right must not open the mic; Win+Shift+S must not start move mode; typing with AltGr must not start push-to-talk; holding Win+Shift still moves the island and a Start-menu tap still works.
57. **Typing safety**: dictate into a password field (must refuse), then into Notepad (works), a very long text (refused, copied instead).
58. **Windows and events**: the lyrics window follows track changes; the Wi-Fi/Bluetooth flyouts update live.
59. **Earned trust**: approve the same harmless action (e.g. "open Calculator") five times; the fifth card offers "don't ask again"; revoke it in Settings > Permissions. Deny once: count resets.
60. **Undo**: change a setting by voice, then say "undo that"; also the Undo button on Desk > Activity.
61. **Open loops**: say "I'll send the report tomorrow at 5", end the conversation, wait a couple of minutes: it should show under Desk > Open loops and remind you.
62. **Phone link**: Settings > Devices > turn on, note the address and code; on the vivo T4 Ultra open the address in Chrome (same Wi-Fi), pair, trigger a confirm card on the PC (e.g. "delete <test file>") and approve it from the phone. Revoke the device and check the phone is locked out. Follow `docs/MOBILE.md` for the OriginOS battery settings.
63. **Draft as me / weekly review**: "draft a reply to this in my style" (draft only); say "weekly review".
64. **Eval**: `Lokey.exe --eval` (needs a provider key).

65. **Android app**: install the APK on the vivo T4 Ultra, pair, ask for something that shows a confirm card on the PC: check the heads-up notification (Allow/Deny), whether the Origin Island shows it, the popup, the widget, the Quick Settings tile and Share > Lokey. Note what vivo does with the notification (island or plain heads-up).

66. **Phone standalone**: unpaired, add your Gemini key in the app's Settings, then: "set a timer for 2 minutes", "open WhatsApp", "turn on the flashlight", "remember that my sister is called <name>", then later "what is my sister's name?"; also by voice in English and in Tamil (Settings > Speaking). Then pair with the PC and check: "ask my PC to open Notepad", and that a fact told to the phone shows up on Bond on the PC (and the other way round) within ~5 minutes.

67. **Android app** (`app/release/android/Lokey-mobile-0.6.0-debug.apk`; copy to the phone, allow unknown apps): first-run setup (Gemini key, language, permissions); then check in this order: the island capsule at the camera hole and its look; hold-to-talk and a spoken answer (English, then Tamil/Tanglish); the spirit's poses/emotes; music capsule + lyrics (play a song in Spotify, grant Notification access); timer card; "set a timer", "open WhatsApp", "turn on the flashlight"; Inbox (grant Notification access) and "reply as me"; pairing with the PC and an approval card; Accessibility (Settings > Accessibility > Lokey; sideloaded apps need "Allow restricted settings" first) and "what's on my screen?"; clap wake-up; widget; QS tiles; whether OriginOS shows the confirm notification in the real Origin Island. Send me what fails (adb logcat if you can: `adb logcat | findstr -i lokey`).

68. **System island** (APK 0.7.0): grant Display over other apps, Settings > Notifications > Lokey > Live updates, battery Unrestricted, notification access. Leave Lokey (home screen) and: start a timer by voice, play a song, ask for something that needs approval. Check: the black pill at the camera hole over other apps, expand/swipe/hold-to-talk, whether the Live Update chip or the real Origin Island appears, and what happens over a fullscreen video. Report what you see.

69. **Outside the app** (APK 0.8.0): uninstall the old Lokey first. Grant Display over other apps, battery Unrestricted, vivo Autostart, Live updates, notification access. Open You > Island > Background health: all rows should be green. Press Home, then check: the black pill appears at the camera and responds to tap/swipe/hold; clap twice with the app in the background; say a wake phrase; start a timer by voice then leave the app. Use the vivo probe buttons and answer Yes/No. Send me the Background health screenshot if anything is red.
70. **Second screen** (optional): install Shizuku, start it via wireless debugging, allow Lokey, You > Power tier > Test second screen; then "open Settings on the second screen and tell me the Android version".

## What to send back
For each failure: what you did, what you expected, what happened, plus the last ~30 lines of `main.log` and `host.log`. For hangs: whether the pointer froze system-wide or only the island, and for how long.

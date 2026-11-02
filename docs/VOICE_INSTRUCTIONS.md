# Dictating AI instructions

The shared browser dictation control appears beside the web and mobile AI composer. It uses SpeechRecognition/webkitSpeechRecognition with the device language, on a secure page, after an explicit click. It adds no paid transcription API or audio upload endpoint to Humeto.

Speech is previewed separately. Stop, choose Use dictated text, review/edit the composer, then Send. The original draft is preserved and the combined instruction is limited to 2,000 characters. Dictation stops when the page is hidden, access becomes disabled, or the component unmounts. Permission/service errors leave typing available.

Browser support varies. In particular, Android System WebView can lack usable browser speech recognition even when Chrome supports it. The installed app then explains how to use the keyboard microphone; this release does not add a native recognizer. No offline or universal browser support is promised. Browser vendors may process audio remotely under their own policies. Humeto receives the transcript only when the instruction is sent; normal AI processing still applies.

Verification: web/mobile production compilation, Android APK build, browser tests with simulated recognition results/permission failure and unsupported API, plus existing chat keyboard layout test. These do not certify real-device recognition quality or permission behavior; test those on supported phones/laptops. iPhone testing remains deferred.

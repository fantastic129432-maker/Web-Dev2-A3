# How to record the demonstration video

This is the operating sheet: which tool to use on this machine, what to prepare,
and the exact URLs to type. The words to say are in `video-script.md`; this file
is about the mechanics of recording them.

Everything below refers to the software actually installed here, verified:

| Software | Version | Path |
| --- | --- | --- |
| **OBS Studio** | 31.0.2 | `C:\Program Files\obs-studio\bin\64bit\obs64.exe` |
| MySQL Workbench | 26.7.0 (Electron interface) | `%LOCALAPPDATA%\Programs\MySQL\MySQL Workbench\` |
| Postman | 12.29.5 | `%LOCALAPPDATA%\Postman\Postman.exe` |
| VS Code | 1.138.0 | `%LOCALAPPDATA%\Programs\Microsoft VS Code\` |
| Snipping Tool | 11.2607.23.0 | Start menu - fallback recorder |
| PowerPoint | Office 16 | Fallback recorder |
| Xbox Game Bar | **not installed** | `Win`+`G` does nothing, ignore it |

---

## 1. Record with OBS, not the Snipping Tool

OBS is already installed, so use it. Compared with the Snipping Tool it gives you:

* a **scene** you set up once, so every take starts with the same layout;
* a **microphone level meter**, so you can see you are audible before you record
  rather than discovering silence afterwards;
* **separate audio and video settings** and a real bitrate, so small text and JSON
  stay readable after compression - which matters when the marker is reading code
  in your video;
* the ability to add a **second scene** for a full screen code view.

### First-time setup, about five minutes

1. Launch OBS: Start menu, or
   `C:\Program Files\obs-studio\bin\64bit\obs64.exe`.
2. On first launch it offers the **Auto-Configuration Wizard**. Choose
   **Optimise for recording**, not for streaming, and accept the rest.
3. In the **Scenes** box at the bottom left, rename `Scene` to `Demo`.
4. In the **Sources** box, click **+** and add **Display Capture**. Select the
   monitor you will actually work on.
5. Add a second source, **Audio Input Capture**, and pick the microphone. On this
   laptop the device is **麦克风阵列 (2- Realtek(R) Audio)**.
6. Watch the **Audio Mixer** panel at the bottom while you talk: the bar must move
   on the microphone channel. If it does not, the wrong device is selected.
7. Open **Settings > Output**:
   * Output Mode: **Advanced**
   * Recording tab: **Encoder** `x264`, **Rate Control** `CRF`, **CRF** `20`
   * **Recording Format** `mkv` - if OBS or the machine crashes, an MKV is still
     playable while an MP4 is not
8. Open **Settings > Video**: **Base and Output resolution** `1920x1080`,
   **FPS** `30`.
9. Click **Start Recording**, talk for twenty seconds, click **Stop Recording**,
   and play the file back. Confirm you can hear yourself.

**Before every real take, check the microphone bar moves.** A silent recording is
the most expensive mistake here, because it is only discovered afterwards.

### Converting and trimming

OBS records to MKV. Use **File > Remux Recordings** to produce an MP4, which is
what OneDrive expects. To trim the start and end, right-click the file and choose
**Open with > Clipchamp**, which is built into Windows.

---

## 2. Service status before you start

All three were verified running. If the machine has been restarted since, run
`node tools/start-all.mjs` from the project folder. Leave it running while you
record; Ctrl+C in that terminal stops the API and the website together.

| Service | Port | How to check |
| --- | --- | --- |
| MySQL 8.4.11 (Windows service `MySQL84`) | 3306 | `Get-Service MySQL84` |
| Express API | 3000 | open `http://localhost:3000/api/health` |
| Client website | 5500 | open `http://localhost:5500/index.html` |

---

## 3. What to have open, and why

### Browser tabs, in this order

| # | Tab |
| --- | --- |
| 1 | `http://localhost:5500/index.html` - home page, opens Question 3 |
| 2 | `http://localhost:5500/search.html` - the main demonstration |
| 3 | `http://localhost:3000/api/events?state=all&limit=3` - raw JSON |
| 4 | Your GitHub repository, commits page - work progress, at the end |

### MySQL Workbench 26.7.0

Open the saved connection **`charityevents_db`**. It is already configured
(`charity_app@127.0.0.1:3306`, state `Connected`). Expand
**SCHEMAS > charityevents_db** so both **Tables** and **Views** are visible - that
is the shot for Question 1.

Have this query ready in a SQL tab, but do not run it until you need it:

```sql
SELECT event_id, event_name, event_state, city,
       raised_amount, goal_amount, progress_percent
FROM vw_public_events
ORDER BY event_date;
```

> This is the new Electron interface, so it does not look like the older Qt
> Workbench shown in most tutorials. The **SCHEMAS** panel is still on the left
> and **Run** is still the blue button at the top right.

### Postman 12.29.5

Import the collection from
`docs/postman/PROG2002-A2-Charity-Events-API.postman_collection.json`
(**File > Import**). It holds 18 ready requests with 33 assertions, grouped as
Health, Home page, Search page, Event detail, and Validation and error handling.

For Question 1, leave these two open in tabs:

* **Search page > `GET /events` (three criteria at once)**
* **Validation and error handling > `GET /events` (invalid date range) -> 400**

### VS Code 1.138.0

Open the project folder so these files are one keystroke away, and use
`Ctrl` + `P` to jump between them by name rather than hunting in the sidebar:

* `database/01_schema.sql` - the schema and the two views
* `api/src/db/event_db.js` - the required connection file
* `api/src/repositories/repository.mysql.js` - the search SQL
* `clientside/js/search.js` - collecting the form and calling the API
* `clientside/js/dom.js` - turning the response into DOM

---

## 4. Exact URLs to have ready

Paste these rather than typing them on camera:

```
http://localhost:3000/api/events?state=all&limit=3
http://localhost:3000/api/events?state=all&city=Lismore&category=1&from=2026-01-01
http://localhost:3000/api/events?from=2026-12-01&to=2026-01-01
http://localhost:3000/api/events/11
```

| URL | What it demonstrates |
| --- | --- |
| first | the JSON envelope, with `meta` and `data` |
| second | three criteria at once, returns exactly one event |
| third | deliberately invalid, returns **400** with a `details` array naming the field |
| fourth | the suspended event, returns **404** - proof it is hidden |

In Postman the same four are already saved, and the status code sits at the top
right of the response, which reads better on video than the browser's Network
panel.

---

## 5. Silence the machine

1. `Win` + `A` for Quick Settings, turn on **Do not disturb**.
2. Close WeChat, Outlook, Teams and any other messaging application.
3. Browser zoom to **110-125%** with `Ctrl` + `+`. At 100% the JSON and the code
   are hard to read once the video is compressed.
4. Hide the bookmarks bar with `Ctrl` + `Shift` + `B`.
5. Plug the charger in. Many laptops throttle the CPU on battery, which makes the
   pages feel slow on camera.
6. Close anything else that might claim the microphone before OBS does.

---

## 6. Length and structure

The limit is **15 minutes** and the brief marks three specific questions. The
timeline in `video-script.md` is 13 minutes 30 seconds:

| Section | Length |
| --- | --- |
| Introduction, with your name and student number | 0:40 |
| Question 1 - database and API architecture | 4:20 |
| Question 2 - data flow between API and website | 3:30 |
| Question 3 - the pages, live | 4:00 |
| Work progress, testing and closing | 1:00 |

**Record in sections, not in one take.** Stop OBS after each section. Re-record
only the part you fumbled, then join the parts in Clipchamp. A single 14 minute
take almost always contains one sentence you want back.

**Keep `video-script.md` open on paper or a second screen.** Reading a prepared
script is normal and is not penalised.

---

## 7. Rehearse once without recording

Do the three demonstrations end to end before you press Record, and fix anything
slow or broken:

1. Home page - let the event list load, and notice how long it takes.
2. Search page - filter by Lismore + Fun Run + a date range, then **Clear
   Filters**, then trigger the invalid date range to see the message appear.
3. Event detail - open an event and press **Register**, which now goes to the
   **registration page**; fill the form and complete a registration so you know
   how long it takes and what the confirmation looks like.
4. Admin site - open `http://localhost:5500/admin/index.html`, click **Events**,
   and try to delete an event that has registrations so you have seen the
   blocked-delete message before you have to explain it on camera.

Time yourself. If a section runs long, cut detail from the tour rather than
rushing the explanation: the marker is listening for the three questions, not for
a complete inventory of the site.

---

## 8. After recording

- [ ] Play it back with sound. Your **name and student number** must be audible in
      the first 30 seconds.
- [ ] Remux to MP4 in OBS, and trim with Clipchamp if needed.
- [ ] Confirm the total length is under 15 minutes.
- [ ] Confirm the three question headings are answered out loud, not merely shown.
- [ ] Confirm the exact sentence **"This feature is currently under
      construction."** is audible when you press Register.
- [ ] Upload to your **SCU OneDrive**, set sharing so anyone with the link can
      view, and test the link in a **private** browser window - not the one you are
      signed into.
- [ ] Paste the shareable link into the Blackboard submission.

---

## 9. If something goes wrong

| Symptom | Cause and fix |
| --- | --- |
| No sound in the recording | Wrong microphone in OBS, or the channel is muted in the Audio Mixer. Check the bar moves before every take. |
| The recording shows the wrong screen | The Display Capture source points at another monitor. Select the correct display in the source's properties. |
| The video looks soft and the code is unreadable | Output resolution below 1080p, or browser zoom too small. Set 1080p in Settings > Video, zoom the browser to 110-125%. |
| OBS reports dropped frames | Lower FPS to 30, close other applications, plug the charger in. |
| The event list is empty on camera | The API stopped. Open `http://localhost:3000/api/health`; if it is down, run `node tools/start-all.mjs`. |
| Workbench will not connect | The MySQL service stopped. In an administrator command prompt run `net start MySQL84`. |
| Postman returns 404 for every request | The `baseUrl` variable is wrong. It should read `http://localhost:3000/api` in the collection variables. |
| A notification appears mid-take | Stop, re-record that section, cut it in the editor. Do not restart the whole video. |
| The file will not upload to OneDrive | It is still MKV. Use **File > Remux Recordings** in OBS. |

# Code reviews

Each review covered every application module, the HTML and CSS, the service worker, the tests, the build scripts, and the workflow. [Verification](VERIFICATION.md) has the test and performance results.

## 4 October 2026

This review made two passes. The second pass also reviewed the changes from the first.

| Finding | Effect before the fix | Change |
| --- | --- | --- |
| A saved rate table reset the status | After a failed rate check, a window focus read the same saved table again and set the status to ready. Retry disappeared while the text still reported the failure. | A table that is not newer no longer changes the status. The phase stays `error` while an error is set. |
| Window focus cleared the chart | Each focus, tab return, and reconnect cleared the chart, loaded the same series, and moved the selection to the last point. | Loading the range already on screen keeps the series. If the series is less than one hour old, the load does nothing. |
| An online request reused an offline load | When the connection returned during an offline load, the chart stayed offline. | The app reuses a load in progress only for the same connection state. |
| The history cache did too much work | Each chart load read the whole IndexedDB store twice, validated each record at least three times, copied every point more than once, and rewrote the record to update its last-use time. | The app reads only history keys, once per page load. It validates each record once and does not copy it. It writes the last-use time at most once an hour. |
| The chart drew twice | The app hid the chart before each load, so the resize observer drew it a second time. | The observer draws only when the size changed. |
| Each pointer move created formatters | Each pointer move created two `Intl` formatters and two SVG nodes. Each draw created eight formatters. | The chart creates its formatters once and moves one selection line and point. A pointer move to the same point does nothing. |
| The chart built its picker too soon | The chart built 166 picker rows when it opened and sorted the catalog three times. | The chart builds the rows when the picker opens. |
| `getEntriesByName` ran on each keystroke | The timing helper read every performance entry after each input event. | A counter replaces the read. |
| Helpers had several copies | The date and rate validators, the code pattern, the Decimal configuration, the retry delays, the text for the time of the last check, and the period list each had two or three copies. | Each has one copy. |
| Some code had no caller | Nothing used a navigation branch, the `destroy` and `dispose` methods, some options that only tests passed, two icon symbols, three CSS rules, and an SVG group. | The review removed them. Chart navigation has three fewer state variables. |
| The build did unneeded work | Each build ran `sharp` to write five icons that are already in the repository. The build published the icon source file and the service worker saved it, but nothing used it. The precache list had five duplicate entries. | A build no longer makes icons, and the source file is gone. The list has 19 entries with no duplicates. |
| The size script parsed by hand | A 30-line parser read the worker one character at a time. | One regular expression does the same. The script is 40 lines, down from 97. |
| `src/app.js` had long lines | Nine lines had more than 200 characters, with nested conditional expressions. | The file has the same size in bytes, with one statement per line and plain `if` statements for the status text. |

The review also made smaller changes. The status now says "Checked 1 day ago" where it said "1 days". Choosing the current currency in the chart picker closes the dialog. The Pages build job no longer repeats its job condition on each step. Functions with three positional inputs now take one object.

One change guards against a failure that the review did not reproduce. The app now reads the saved catalog before it decides to request the catalog. Before, a slow database could cause a catalog request on each page load.

New tests cover each fix that changes behavior. Three of them fail on the build from before this review. They test Retry after a window focus, the selected chart point after a window focus, and the number of chart draws.

## 26 September 2026

| Finding | Effect before the fix | Change |
| --- | --- | --- |
| The picker rebuilt itself on each opening | Each opening created 166 controls. A catalog update could remove the focused checkbox. | `src/picker.js` keeps one control per code and preserves focus, selection, and scroll position. |
| Card writes changed nothing | Each edit wrote four attributes on each card. | The app writes an attribute only when it changes. |
| Storage waits had no limit | A stalled IndexedDB could block the first rate request or hold up a rate check. | Opens and transactions time out after one second, and the app continues from memory. |
| Locale digits failed to parse | Amounts in Arabic, Persian, and Bengali digits, Indian grouping, and Swiss separators did not parse. | The parser gets digits and group sizes from `Intl` and displays the same digits. |
| Undo ignored another tab's change | Undo could restore an amount older than the one from the other tab. | Undo restores the row and keeps newer values. |
| The catalog time could be in the future | After a clock change, a saved time in the future could stop catalog requests for days. | Rates and the catalog share one age check with a five-minute tolerance. |

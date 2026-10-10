# Two browser behaviours that look like bugs

Both of these were reported as defects during development and cost real time to
chase. Neither is caused by this project, so they are written down here with the
evidence, and with how to check the claim rather than take it on trust.

---

## 1. A vertical line appears in the text when you click it

**What it is:** the browser's text insertion caret.

When you click on text inside a non-editable element, Chromium places a
collapsed selection - a caret - at that point. It is standard behaviour on every
website, and it disappears as soon as you click elsewhere.

**The evidence.** A control experiment was run: click a heading on this project's
page and click a heading on a `data:` page that has none of this project's CSS,
then compare the resulting selection.

| Page | `selection.type` | `collapsed` |
| --- | --- | --- |
| Neutral page, no stylesheet of ours | `Caret` | true |
| This project, hero heading | `Caret` | true |
| This project, contact paragraph | `Caret` | true |

Identical in all three cases, so the behaviour comes from the browser rather than
from the page.

**How to check it yourself.** Open any website, click a paragraph, and watch for
the same caret. Then in this project open the browser console and confirm what
the click produced:

```js
document.addEventListener('mouseup', () => {
  const s = window.getSelection();
  console.log(s.type, s.isCollapsed);   // "Caret true" for a plain text click
});
```

**If it is distracting.** There is exactly one way to stop it, and it is a
trade-off rather than a fix:

```css
/* Stops the caret, but also stops the visitor selecting or copying the text. */
.user-select-none { user-select: none; }
```

It is deliberately **not** applied to the content. Hiding it site-wide would stop
visitors copying an event name, address or price, which they have good reason to
do, and disabling text selection is generally regarded as hostile. If the caret
is unwanted on purely decorative text - the hero headline, the statistic values -
the rule can be applied to those elements alone while paragraphs, prices,
addresses and descriptions stay selectable.

**Related, but this one really was ours.** An earlier revision of the section
jump added `tabindex="-1"` to its target and called `focus()` on it. That made a
whole section behave like a text input, so clicking its paragraphs put a caret
there, and the same focus also drew the `:focus-visible` ring around the section,
which read as an unexplained amber outline. Both are fixed: the jump now only
scrolls. See the commit `fix(client): stop the section jump from making page
content focusable`.

---

## 2. A coloured band appears at the top or bottom edge while scrolling

**What it is:** the browser's scroll-chain indicator.

When a scroll gesture reaches the end of the page and continues, Chromium flashes
a band at that edge to show that the page has nothing more to give. The band
belongs to the browser window rather than to the document, so it cannot be styled
or removed from the page.

**How to tell it apart from a page element.** Three differences:

| | Browser scroll indicator | A page element |
| --- | --- | --- |
| Width | Spans the whole window, including outside the content container | Usually aligned with the content |
| Timing | Appears only during a scroll gesture, then fades | Always present |
| Position | Exactly at the very top or bottom edge of the viewport | At a section or panel boundary |

**How to check it yourself.** Stop scrolling: the band disappears on its own. Or
inspect the point with the browser's element picker; if the picker selects the
`<html>` or `<body>` element rather than a styled element, nothing in the page is
painting it.

**A related case that was ours.** A warm horizontal edge on the home page turned
out to be the `:focus-visible` outline being drawn around a whole section after a
jump link, which is described under item 1. It was fixed by removing the focus
call, and `#f0a04b` - the amber used for focus rings - is the colour to look for
if a similar line reappears.

---

## Automated checks that guard the fixes

The two real defects described above are covered by assertions, so they cannot
return unnoticed:

```bash
node tests/run-tests.js
```

* `jumping to a section does not make page content focusable` -
  no element may carry a `tabindex` after a section jump, which is what produced
  both the caret and the amber ring.
* `a section link puts its section in view, not just scrolls` - the jump must
  actually position the section, and must not rely on a smooth animation that the
  page growing can cancel.
* `no rule paints light text on a background that flips to light` - the class of
  theme defect that once made the footer unreadable.

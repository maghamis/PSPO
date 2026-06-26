# PSPO Study Coach

A static Progressive Web App (PWA) for studying Professional Scrum Product Owner I concepts.

## Features

- Dashboard with progress, weak topics, and exam readiness
- Short lessons and searchable quick reference
- Full Scrum Guide text inside the app
- Select Scrum Guide text and save it to **Study Later**
- Convert Study Later selections into your own flashcards or lessons
- Add your own flashcards manually
- Add your own lessons/notes manually
- Flashcards with simple spaced repetition
- Practice quiz with instant feedback
- Exam simulator: 80 questions, 60 minutes, 85% target
- Mistake review with explanations
- Offline caching after first load
- Progress stored locally in the browser

## Run locally on your computer

Unzip the folder, open a terminal in the folder, then run:

```bash
python -m http.server 8080
```

Open:

```text
http://localhost:8080
```

## Use on iPhone

To add it to your iPhone Home Screen, host the folder online using GitHub Pages, Netlify, Vercel, or another static hosting service. Then:

1. Open the hosted URL in Safari on your iPhone.
2. Tap Share.
3. Tap Add to Home Screen.

Note: iPhone will not install a PWA from a local zip file. It needs a normal HTTPS URL.

## How to save Scrum Guide text for later

1. Open the **Guide** tab.
2. Select any text from the Scrum Guide.
3. Tap **Add selected text to Study Later**.
4. Open **Study Later** to review it, mark it studied, or convert it into a flashcard/lesson.

## Edit the question bank

Open `data.js` and add or change items under `questions`, `flashcards`, or `lessons`.

The app also lets you add custom flashcards and lessons directly from the UI. These are stored locally in your browser.

## Attribution

Scrum Guide text is from **The Scrum Guide: The Definitive Guide to Scrum: The Rules of the Game**, November 2020, by **Ken Schwaber and Jeff Sutherland**. Copyright © 2020 Ken Schwaber and Jeff Sutherland. The Scrum Guide text is licensed under the **Creative Commons Attribution Share-Alike 4.0 International License (CC BY-SA 4.0)**.

This app is not affiliated with Scrum.org and does not include official Scrum.org exam questions.

## v3 update

- Added a red rounded marker beside the Guide navigation tab.
- Added a floating red rounded highlighter button on the Scrum Guide screen.
- Select text in the Guide, then tap the small red Highlight marker to highlight it in place. Use the Study Later button separately to save selected text for later review.

## v4 update

- Made the floating red highlighter marker smaller.
- The highlighter now highlights selected Scrum Guide text in place instead of sending it to Study Later.
- Added **Export data** and **Import data** buttons on the Dashboard so progress, custom cards, custom lessons, Study Later items, and highlights can be moved between devices manually.

## v5 update

- Removed the **Clear highlights** button.
- Tap/click an existing highlighted Scrum Guide text selection to delete that individual highlight.
- Export/import still includes all highlights and saved study data.

## v6 update
- Highlights now use the exact selected range in the Scrum Guide paragraph, not every matching word.
- Selecting a repeated word such as "value" only highlights that specific selected occurrence.
- Older v5 text-only highlights are rendered only once rather than across every matching paragraph.

## v7 update

- Added a new **Chart** tab immediately after **Dashboard**.
- Reordered tabs to: Dashboard, Chart, Guide, Learn, Study Later, Cards, Quiz, Exam, Review.
- Added a Scrum Guide visual map with the same six-color scheme: Scrum Definition, Scrum Team, Scrum Artifacts, Scrum Events, Scrum Theory, and Scrum Values.
- The chart is horizontally scrollable on small iPhone screens.

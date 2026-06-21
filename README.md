# Boofer's Den

A group website. One landing page, ten sections — one per person.

## Structure

```
index.html            landing page (grid of doors to each section)
style.css             landing-page styles
sections/<name>/      one folder per person, fully self-contained
    index.html
    style.css
    script.js
```

Each section folder is isolated: editing one person's files never touches anyone else's.

## How to build your section

Ask **Clawcius** in the Discord channel. Examples:

- "Clawcius, on my section set the background to black and add my top 5 albums"
- "Clawcius, add a photo gallery to flypetheus's page"

Clawcius edits the matching `sections/<name>/` folder, commits, and pushes.
Vercel auto-deploys from this repo, so changes go live ~30 seconds after a push.

## Stack

Plain static HTML/CSS/JS — no build step. Vercel serves it as-is.

# Zarhart

**Learn to fly in your browser.** Zarhart is a free, open-source flight simulator and FAA Private Pilot written-exam prep site, named for **Zara Rutherford** and **Amelia Earhart**.

- **Fly:** a browser simulator with a C172-class flight model (tested against book numbers), VFR scenery for pilotage, steam-gauge and G1000-style instruments, and lessons that each tie to written-test questions.
- **Study:** a study guide, flashcards, quizzes, a timed 60-question practice exam, and Quizlet export.
- **Plan:** the free path to your written test: FLY8MA ground school → FAA PHAK → Sporty's and King Schools practice tests → endorsement → FTN in IACRA → book with PSI.

> Study aid only. Not FAA-approved training, and not for real-world navigation.

## Run locally
```bash
npm run serve   # python -m http.server 8765, then open http://localhost:8765
npm test        # headless flight-model checks
```

## Status
Work in progress. See [PLAN.md](PLAN.md) for the full design, what's done, and what's next.

## License
MIT

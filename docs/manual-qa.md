# Manual acceptance flow

Use a separate data directory, e.g. `CAREER_DATA_DIR=./data/qa npm start`. All inputs below are fictional.

1. Open the app with no data. Verify empty states and that Agent mode is disabled without configuration.
2. Load the fictional demo. Expect four sources, three confirmed cards, and one draft.
3. Open the draft about AI summary ownership. Verify the quote, two unresolved questions, and related experience.
4. Check confirmation without choosing a contribution. Saving must fail with an explicit message.
5. Create a new note: “我参与测试用例设计，尚未完成正式验收。” Review its draft. Confirm only after selecting “参与”.
6. Save the same original note again. It must reuse the original source; the UI opens the existing related card.
7. Select the sample AI product manager JD and analyze. Local mode must label keyword overlaps as adjacent, never direct; commercial revenue ownership should remain a gap.
8. Open a citation and verify the historical source text. Export Markdown and verify each E-number maps to the same card as the UI.
9. Edit or withdraw a current card. The previous job run and exported text must remain unchanged.
10. Download a backup; stop the app, restore to a separate data directory, restart and check counts and history.
11. Configure a compatible model separately. Confirm that the mode switch discloses provider transmission; inspect tool summaries. With an invalid key, expect a visible error and the source to remain saved.
12. Check navigation, forms, dialogs and wrapping on a narrow viewport; verify keyboard focus and that user-entered HTML is displayed as text.
13. In the daily journal, record two days in the same week and one day in the following week. Repeat one identical submission; it must not duplicate the source. Same content on a different date must remain a distinct entry.
14. Generate the first week's report. Check its Monday/Sunday bounds, covered-day count, completed/blocker/plan separation, and `[D…]` source links. The following week's note must be absent.
15. Export the weekly Markdown. Add another note to the same week and verify the old report remains unchanged; generate a new version to include the addition.

Automated tests use mocked models. Record real-provider verification separately, with provider/model/date and no secrets or private career data.

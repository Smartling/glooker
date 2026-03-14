# Glooker TODO

## Personalized Email Digest (Strava-style)

### Core
- [ ] Per-person percentile calculation (rank, percentile, gap to next rank)
- [ ] "How to Level Up" nudge engine — rules-based suggestions based on weakest metric:
  - PR% below avg → "routing work through PRs would boost your score by X"
  - Volume low → "N more commits to reach top X%"
  - Close to next rank → "you're 0.4 points behind #N — one more week at this pace"
- [ ] Trend comparison — compare current report to previous same-length report (↑/↓/flat)
- [ ] Highlight: most complex commit, notable achievements ("3rd highest complexity in org")
- [ ] Stats vs team averages table (commits, PRs, complexity, PR rate, AI%)

### Email
- [ ] HTML email template — responsive, dark theme matching dashboard
- [ ] Per-person email generation with personalized stats, nudges, and trends
- [ ] `POST /api/digest/send` endpoint — generates and sends all emails for a report
- [ ] Email delivery via SendGrid / SES / SMTP (configurable)
- [ ] Pull engineer emails from GitHub profile
- [ ] Opt-in/out mechanism

### Scheduling
- [x] Cron-triggered auto-report generation (e.g. every Monday 9 AM ET)
- [ ] Auto-send digest after report completes
- [x] Configurable cadence: weekly / biweekly
- [x] Scheduled/recurring reports (additionally to "Run Report")


### Design Principles
- Never show full leaderboard in email — only "your position" and gap to next
- Always positive framing — opportunities, not failures ("2 more PRs to reach top 25%")
- Show trend direction (↑↓) without dwelling on drops
- Gap-to-next can be by name or anonymous (configurable)
  
---

## Report Improvements
- [ ] Jira integration — story points, ticket linking
- [ ] PR cycle time and review metrics (time to merge, reviews given/received)
- [ ] Trend view in dashboard — compare periods side by side
- [ ] Per-developer drill-down page (commit list, complexity over time)
- [ ] Direct-to-branch commit detection improvement (beyond commit message pattern matching)

---

## Infrastructure
- [ ] Auto-detect and mark stale "running" reports on server startup
- [ ] GitHub App auth option (higher rate limits, no token expiry)

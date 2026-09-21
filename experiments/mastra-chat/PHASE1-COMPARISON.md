# Phase 1 comparison — org=Smartling

## Q1. Who are the top 5 developers by impact score?

  CONTROL  steps=2 tools=1 tok=4466/289 0.6s
  MASTRA   steps=2 tools=1 tok=4776/190 0.2s
### CONTROL
steps=2 tools=1 tokens=4466/289 0.6s
```
queryLeaderboard({"metric":"impact_score","limit":5,"order":"desc"})
```
Top 5 by impact score:

- **@spivenko** — 8.2 (22 commits, 100% PR)
- **@steplov** — 8.1 (25 commits, 28% AI)
- **@TymchenkoOleksandr** — 8.1 (31 commits, 65% AI)
- **@PavloMyrotiuk** — 8.1 (20 commits, 20% AI)
- **@andreyfurdylo** — 8.1 (18 commits, 11% AI)

### MASTRA
steps=2 tools=1 tokens=4776/190 0.2s
```
queryLeaderboard({"metric":"impact_score","order":"desc","limit":5})
```
Top 5 developers by impact score:

- @spivenko — 8.2
- @steplov — 8.1
- @TymchenkoOleksandr — 8.1
- @PavloMyrotiuk — 8.1
- @andreyfurdylo — 8.1


## Q2. Who has the most commits, and what percentage of the org total is that?

  CONTROL  steps=2 tools=2 tok=4368/176 0.3s
  MASTRA   steps=2 tools=2 tok=4694/166 0.2s
### CONTROL
steps=2 tools=2 tokens=4368/176 0.3s
```
queryLeaderboard({"metric":"total_commits","limit":1})
queryOrgSummary({})
```
**@sduiev-smartling** has the most commits with **128**, which is **8.7%** of the org total (1,474 commits).

### MASTRA
steps=2 tools=2 tokens=4694/166 0.2s
```
queryLeaderboard({"metric":"total_commits","limit":1})
queryOrgSummary({})
```
**@sduiev-smartling** has the most commits with **128**, which is **8.7%** of the org total (1,474 commits).


## Q3. Is the top developer by commits the same person as the top developer by impact score? Answer yes or no and name both.

  CONTROL  steps=2 tools=2 tok=4325/255 0.2s
  MASTRA   steps=2 tools=2 tok=4631/228 0.1s
### CONTROL
steps=2 tools=2 tokens=4325/255 0.2s
```
queryLeaderboard({"metric":"total_commits","limit":1})
queryLeaderboard({"metric":"impact_score","limit":1})
```
No — different people.

- Top by commits: **@sduiev-smartling** (128 commits, impact score 5.7)
- Top by impact score: **@spivenko** (impact score 8.2, 22 commits)

### MASTRA
steps=2 tools=2 tokens=4631/228 0.1s
```
queryLeaderboard({"metric":"total_commits","limit":1})
queryLeaderboard({"metric":"impact_score","limit":1})
```
No — they're different developers.

- **Top by commits:** @sduiev-smartling (128 commits, impact score 5.7)
- **Top by impact score:** @spivenko (impact score 8.2, only 22 commits)


## Q4. Find the single most complex commit from the last 90 days, say who wrote it, then tell me how many commits that person has in total.

  CONTROL  steps=6 tools=5 tok=70598/1373 0.4s
  MASTRA   steps=6 tools=6 tok=15522/919 0.3s
### CONTROL
steps=6 tools=5 tokens=70598/1373 0.4s
```
queryCommits({"days":90,"minComplexity":10,"limit":1})
queryCommits({"days":90,"limit":100})
queryCommits({"limit":100})
queryCommits({"minComplexity":8,"limit":10})
queryDevStats({"logins":["DGSmartling"]})
```
**Most complex commit (last 90 days):** complexity 8/10 — "Initial commit" on `file-zip-service` by **@DGSmartling** (2026-03-13, infra, 4,143 lines added).

Note: it's tied with several other complexity-8 commits from other devs, but this was the most recent one in the window.

**@DGSmartling's total activity:**
- Total commits: **10**
- Total PRs: 10
- Avg complexity: 4.1
- Lines added/removed: 7,805 / 5,547
- Impact score: 6.3

### MASTRA
steps=6 tools=6 tokens=15522/919 0.3s
```
queryCommits({"days":90,"minComplexity":9,"limit":5})
queryCommits({"days":90,"minComplexity":7,"limit":10})
queryCommits({"days":90,"minComplexity":5,"limit":20})
queryCommits({"days":90,"limit":20})
queryCommits({"limit":5})
queryCommits({"minComplexity":10,"limit":5})
```



## Q5. How many developers are in the org, and how does the top developer's commit count compare to the org average?

  CONTROL  steps=2 tools=2 tok=4374/260 0.1s
  MASTRA   steps=2 tools=2 tok=4710/273 0.1s
### CONTROL
steps=2 tools=2 tokens=4374/260 0.1s
```
queryOrgSummary({})
queryLeaderboard({"metric":"total_commits","limit":1})
```
**61 developers** in the org.

- Org avg commits/dev: 1474 ÷ 61 ≈ **24.2**
- Top dev: **@sduiev-smartling** with **128** commits
- That's **~5.3x** the org average

### MASTRA
steps=2 tools=2 tokens=4710/273 0.1s
```
queryOrgSummary({})
queryLeaderboard({"metric":"total_commits","limit":1})
```
**Org size:** 61 developers

**Top developer:** @sduiev-smartling — 128 commits
**Org average:** 1,474 total commits ÷ 61 devs ≈ 24.2 commits/dev

@sduiev-smartling's commit count is about **5.3x** the org average.


DONE

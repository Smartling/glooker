# Phase 1 comparison — org=Smartling

## Q1. Who are the top 5 developers by impact score?

  CONTROL  steps=2 tools=1 tok=4440/190 6.1s
  MASTRA   steps=2 tools=1 tok=4776/272 6.2s
### CONTROL
steps=2 tools=1 tokens=4440/190 6.1s
```
queryLeaderboard({"metric":"impact_score","limit":5,"order":"desc"})
```
Top 5 developers by impact score:

- @spivenko — 8.2
- @steplov — 8.1
- @TymchenkoOleksandr — 8.1
- @PavloMyrotiuk — 8.1
- @andreyfurdylo — 8.1

### MASTRA
steps=2 tools=1 tokens=4776/272 6.2s
```
queryLeaderboard({"metric":"impact_score","limit":5,"order":"desc"})
```
Top 5 developers by impact score:

1. **@spivenko** — 8.2 (22 commits, 100% PR)
2. **@steplov** — 8.1 (25 commits, 88% PR)
3. **@TymchenkoOleksandr** — 8.1 (31 commits, 65% AI)
4. **@PavloMyrotiuk** — 8.1 (20 commits, 100% PR)
5. **@andreyfurdylo** — 8.1 (18 commits, complexity 5.2)


## Q2. Who has the most commits, and what percentage of the org total is that?

  CONTROL  steps=2 tools=2 tok=4359/168 7.0s
  MASTRA   steps=2 tools=2 tok=4720/191 5.8s
### CONTROL
steps=2 tools=2 tokens=4359/168 7.0s
```
queryLeaderboard({"metric":"total_commits","limit":1})
queryOrgSummary({})
```
**@sduiev-smartling** leads with **128 commits** — that's **8.7%** of the org's 1,474 total commits.

### MASTRA
steps=2 tools=2 tokens=4720/191 5.8s
```
queryLeaderboard({"metric":"total_commits","limit":1,"order":"desc"})
queryOrgSummary({})
```
@sduiev-smartling has the most commits with **128**, which is **8.7%** of the org's total 1,474 commits.


## Q3. Is the top developer by commits the same person as the top developer by impact score? Answer yes or no and name both.

  CONTROL  steps=2 tools=2 tok=4324/234 6.2s
  MASTRA   steps=2 tools=2 tok=4660/254 6.0s
### CONTROL
steps=2 tools=2 tokens=4324/234 6.2s
```
queryLeaderboard({"metric":"total_commits","limit":1})
queryLeaderboard({"metric":"impact_score","limit":1})
```
No — the top developer by commits is @sduiev-smartling (128 commits), while the top developer by impact score is @spivenko (8.2 impact score).

### MASTRA
steps=2 tools=2 tokens=4660/254 6.0s
```
queryLeaderboard({"metric":"total_commits","limit":1})
queryLeaderboard({"metric":"impact_score","limit":1})
```
No — different people.

- Top by commits: **@sduiev-smartling** (128 commits, impact score 5.7)
- Top by impact score: **@spivenko** (impact score 8.2, 22 commits)


## Q4. Find the single most complex commit from the last 90 days, say who wrote it, then tell me how many commits that person has in total.

  CONTROL  steps=6 tools=6 tok=14052/877 20.2s
  MASTRA   steps=6 tools=6 tok=32495/1429 28.0s
### CONTROL
steps=6 tools=6 tokens=14052/877 20.2s
```
queryCommits({"days":90,"minComplexity":9,"limit":100})
queryCommits({"days":90,"minComplexity":7,"limit":100})
queryCommits({"days":90,"minComplexity":5,"limit":100})
queryCommits({"days":90,"limit":100})
queryOrgSummary({})
queryCommits({"days":30,"limit":50})
```
Hit the step limit without a final answer.

### MASTRA
steps=6 tools=6 tokens=32495/1429 28.0s
```
queryCommits({"days":90,"minComplexity":9,"limit":100})
queryCommits({"days":90,"minComplexity":7,"limit":100})
queryCommits({"days":90,"minComplexity":5,"limit":100})
queryCommits({"days":90,"limit":100})
queryCommits({"limit":100})
queryCommits({"minComplexity":9,"limit":20})
```
[no text, finishReason=tool-calls]


## Q5. How many developers are in the org, and how does the top developer's commit count compare to the org average?

  CONTROL  steps=2 tools=2 tok=4374/274 6.9s
  MASTRA   steps=2 tools=2 tok=4725/244 6.1s
### CONTROL
steps=2 tools=2 tokens=4374/274 6.9s
```
queryOrgSummary({})
queryLeaderboard({"metric":"total_commits","limit":1})
```
**Org size:** 61 developers

**Top committer:** @sduiev-smartling — 128 commits

- Org average: 1,474 total commits ÷ 61 devs ≈ **24.2 commits/dev**
- @sduiev-smartling is about **5.3x** the org average

### MASTRA
steps=2 tools=2 tokens=4725/244 6.1s
```
queryOrgSummary({})
queryLeaderboard({"metric":"total_commits","limit":1})
```
- **Total developers:** 61
- **Org average commits/dev:** 1,474 ÷ 61 ≈ 24.2
- **Top developer:** @sduiev-smartling with 128 commits

@sduiev-smartling's commit count is about **5.3x** the org average (128 vs 24.2).


DONE

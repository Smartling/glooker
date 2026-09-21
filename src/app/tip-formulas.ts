export const TIP_FORMULAS: Array<{
  terms: Array<{
    text: string;
    color: 'blue' | 'emerald' | 'amber' | 'red' | 'purple' | 'cyan';
  }>;
  operators: string[];
  layout?: 'inline' | 'fraction';
  fractionSplit?: number;
}> = [
  // Tip 1: High complexity scores often indicate meaningful engineering work
  {
    terms: [
      { text: "Impact", color: "amber" },
      { text: "Complexity", color: "purple" },
      { text: "Consistency", color: "emerald" },
    ],
    operators: ["=", "×"],
    layout: "inline",
  },
  // Tip 2: Lines of code deleted can be more valuable than lines added
  {
    terms: [
      { text: "Deletions", color: "emerald" },
      { text: "Additions", color: "blue" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 3: A spike in code churn usually signals unclear requirements
  {
    terms: [
      { text: "Churn", color: "red" },
      { text: "Unclear Specs", color: "purple" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 4: Track cyclomatic complexity trends per repo, not absolute values
  {
    terms: [
      { text: "Trends", color: "emerald" },
      { text: "Absolutes", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 5: Reward teams that reduce complexity without changing behavior
  {
    terms: [
      { text: "Same Behavior", color: "emerald" },
      { text: "Less Complexity", color: "purple" },
      { text: "Skill", color: "amber" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 6: If your hottest files are also your most complex, you have a ticking time bomb
  {
    terms: [
      { text: "Hot Files", color: "red" },
      { text: "Complexity", color: "purple" },
      { text: "Time Bomb", color: "red" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 7: Code quality isn't binary. Use a spectrum
  {
    terms: [
      { text: "Fragile", color: "red" },
      { text: "Adequate", color: "amber" },
      { text: "Resilient", color: "emerald" },
    ],
    operators: ["→", "→"],
    layout: "inline",
  },
  // Tip 8: Large functions that change frequently are bad
  {
    terms: [
      { text: "Size", color: "blue" },
      { text: "Churn", color: "red" },
      { text: "Risk", color: "red" },
    ],
    operators: ["×", "="],
    layout: "inline",
  },
  // Tip 9: Don't confuse verbosity with clarity
  {
    terms: [
      { text: "Clarity", color: "emerald" },
      { text: "Verbosity", color: "red" },
    ],
    operators: ["≠"],
    layout: "inline",
  },
  // Tip 10: A repo with zero lint warnings and terrible architecture is still a liability
  {
    terms: [
      { text: "Lint Pass", color: "blue" },
      { text: "Bad Design", color: "red" },
      { text: "Liability", color: "red" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 11: Track the ratio of test code to production code
  {
    terms: [
      { text: "Test Code", color: "emerald" },
      { text: "Prod Code", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 12: High-quality code is code your team can modify confidently six months from now
  {
    terms: [
      { text: "Quality", color: "emerald" },
      { text: "Future Confidence", color: "amber" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 13: If every PR touches the same five files, coupling problem
  {
    terms: [
      { text: "Same Files", color: "red" },
      { text: "Every PR", color: "blue" },
      { text: "Coupling", color: "red" },
    ],
    operators: ["×", "="],
    layout: "inline",
  },
  // Tip 14: Measure code duplication trends, not snapshots
  {
    terms: [
      { text: "Trends", color: "emerald" },
      { text: "Snapshots", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 15: The most dangerous code is code nobody wants to touch
  {
    terms: [
      { text: "No Owner", color: "red" },
      { text: "Danger", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 16: A clean git blame tells a story
  {
    terms: [
      { text: "Clean Blame", color: "emerald" },
      { text: "Clear Story", color: "amber" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 17: Complexity per commit is more revealing than complexity per file
  {
    terms: [
      { text: "Complexity", color: "purple" },
      { text: "Commit", color: "cyan" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 18: Static analysis tools catch syntax issues. Only humans catch design flaws.
  {
    terms: [
      { text: "Automation", color: "cyan" },
      { text: "Humans", color: "emerald" },
      { text: "Full Coverage", color: "amber" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 19: When a single file exceeds 500 lines, it's usually doing too much
  {
    terms: [
      { text: "File Size", color: "red" },
      { text: "500 Lines", color: "amber" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 20: Dead code is technical debt with zero upside
  {
    terms: [
      { text: "Dead Code", color: "red" },
      { text: "Zero Value", color: "red" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 21: If your test suite takes over 20 minutes, devs stop running it
  {
    terms: [
      { text: "Test Time", color: "red" },
      { text: "Adoption", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 22: Code coverage above 90% often means testing implementation details
  {
    terms: [
      { text: "Coverage", color: "blue" },
      { text: "Behavior Tests", color: "emerald" },
    ],
    operators: ["≠"],
    layout: "inline",
  },
  // Tip 23: Track how often builds break after merges
  {
    terms: [
      { text: "Merge Breaks", color: "red" },
      { text: "Test Gaps", color: "purple" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 24: Best indicator of code quality is how fast a new member ships first PR
  {
    terms: [
      { text: "Quality", color: "emerald" },
      { text: "Time to First PR", color: "cyan" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 25: Functions with more than four parameters need refactoring
  {
    terms: [
      { text: "Params", color: "red" },
      { text: "4", color: "amber" },
      { text: "Refactor", color: "purple" },
    ],
    operators: [">", "→"],
    layout: "inline",
  },
  // Tip 26: Watch for shotgun surgery patterns
  {
    terms: [
      { text: "One Change", color: "blue" },
      { text: "Many Files", color: "red" },
      { text: "Coupling", color: "red" },
    ],
    operators: ["→", "="],
    layout: "inline",
  },
  // Tip 27: Direct pushes to main should trigger an alert
  {
    terms: [
      { text: "Direct Push", color: "red" },
      { text: "Alert", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 28: Track merge-without-approval rate. Above 5% needs attention
  {
    terms: [
      { text: "No Approval", color: "red" },
      { text: "Total Merges", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 29: PRs open longer than 5 days cause merge conflicts
  {
    terms: [
      { text: "PR Age", color: "red" },
      { text: "Conflict Risk", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 30: Ideal PR size is 200-400 lines
  {
    terms: [
      { text: "PR Size", color: "blue" },
      { text: "Review Quality", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 31: A PR with zero comments isn't quality — nobody read it
  {
    terms: [
      { text: "Zero Comments", color: "red" },
      { text: "No Review", color: "red" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 32: Track time-to-first-review
  {
    terms: [
      { text: "First Review", color: "cyan" },
      { text: "24 Hours", color: "amber" },
    ],
    operators: ["<"],
    layout: "inline",
  },
  // Tip 33: Self-merges should be the exception
  {
    terms: [
      { text: "Self Merges", color: "red" },
      { text: "Total Merges", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 34: Number of review cycles reveals spec quality
  {
    terms: [
      { text: "Review Cycles", color: "cyan" },
      { text: "Spec Clarity", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 35: One person approves 80% of PRs = bus factor of one
  {
    terms: [
      { text: "Solo Reviewer", color: "red" },
      { text: "Bus Factor 1", color: "red" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 36: Require two reviewers on auth, payments, data pipelines
  {
    terms: [
      { text: "Critical Path", color: "red" },
      { text: "2 Reviewers", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 37: Track PR rejection rates
  {
    terms: [
      { text: "Too Low", color: "red" },
      { text: "Rejections", color: "amber" },
      { text: "Too High", color: "red" },
    ],
    operators: ["←", "→"],
    layout: "inline",
  },
  // Tip 38: Draft PRs are underused
  {
    terms: [
      { text: "Draft PRs", color: "cyan" },
      { text: "Early Feedback", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 39: Review turnaround time is a team health metric
  {
    terms: [
      { text: "Review Speed", color: "cyan" },
      { text: "Team Health", color: "emerald" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 40: PRs that skip CI checks cause incidents
  {
    terms: [
      { text: "Skip CI", color: "red" },
      { text: "Incidents", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 41: Healthy team has approval distribution across 3-4 reviewers
  {
    terms: [
      { text: "Approvals", color: "cyan" },
      { text: "Reviewers", color: "blue" },
      { text: "Health", color: "emerald" },
    ],
    operators: ["/", "="],
    layout: "inline",
  },
  // Tip 42: Track PRs approved on first review cycle
  {
    terms: [
      { text: "First Pass", color: "emerald" },
      { text: "Quality", color: "amber" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 43: Stacked PRs reduce review burden
  {
    terms: [
      { text: "Stacked PRs", color: "cyan" },
      { text: "Review Load", color: "blue" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 44: Average PR description under two sentences = review culture needs work
  {
    terms: [
      { text: "PR Context", color: "emerald" },
      { text: "Review Depth", color: "cyan" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 45: Monitor weekend and late-night PR merges
  {
    terms: [
      { text: "Off-Hours", color: "red" },
      { text: "Incidents", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 46: Best reviewers catch design issues
  {
    terms: [
      { text: "Design Insight", color: "emerald" },
      { text: "Speed", color: "blue" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 47: Track ratio of review comments that lead to code changes
  {
    terms: [
      { text: "Acted On", color: "emerald" },
      { text: "Dismissed", color: "red" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 48: Force-pushes to shared branches destroy context
  {
    terms: [
      { text: "Force Push", color: "red" },
      { text: "Context", color: "purple" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 49: Healthy PR pipeline has consistent flow
  {
    terms: [
      { text: "Steady Flow", color: "emerald" },
      { text: "Boom Bust", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 50: Pair programming can replace some code reviews
  {
    terms: [
      { text: "Pairing", color: "cyan" },
      { text: "Reviews", color: "blue" },
      { text: "Quality", color: "emerald" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 51: If PRs routinely need 3+ review cycles, invest in design docs
  {
    terms: [
      { text: "Design Docs", color: "emerald" },
      { text: "Review Cycles", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 52: Auto-assign reviewers based on file ownership
  {
    terms: [
      { text: "Auto-Assign", color: "cyan" },
      { text: "Bottlenecks", color: "red" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 53: Track what percentage of code is AI-assisted
  {
    terms: [
      { text: "AI Code", color: "purple" },
      { text: "Total Code", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 54: AI-generated code that skips review → incidents
  {
    terms: [
      { text: "AI Code", color: "purple" },
      { text: "Review", color: "cyan" },
      { text: "Incidents", color: "red" },
    ],
    operators: ["without", "="],
    layout: "inline",
  },
  // Tip 55: Developers using AI ship more PRs — check quality
  {
    terms: [
      { text: "AI Volume", color: "blue" },
      { text: "AI Quality", color: "emerald" },
    ],
    operators: ["≠"],
    layout: "inline",
  },
  // Tip 56: AI adoption isn't uniform. Pair adopters with skeptics
  {
    terms: [
      { text: "Adopters", color: "emerald" },
      { text: "Skeptics", color: "amber" },
      { text: "Balance", color: "cyan" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 57: Best AI workflows have human reviewing every generated test
  {
    terms: [
      { text: "AI Tests", color: "purple" },
      { text: "Human Review", color: "emerald" },
    ],
    operators: ["+"],
    layout: "inline",
  },
  // Tip 58: If AI code has higher revert rate, need better prompts
  {
    terms: [
      { text: "AI Reverts", color: "red" },
      { text: "Prompt Quality", color: "purple" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 59: Track AI tool usage per repo
  {
    terms: [
      { text: "AI Usage", color: "purple" },
      { text: "Repo", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 60: AI excels at boilerplate, watch quality for core logic
  {
    terms: [
      { text: "Boilerplate", color: "emerald" },
      { text: "Core Logic", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 61: Over-reliance on AI → can't debug
  {
    terms: [
      { text: "AI Reliance", color: "purple" },
      { text: "Debug Skill", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 62: Measure time-to-merge for AI PRs vs. manual
  {
    terms: [
      { text: "AI Merge Time", color: "purple" },
      { text: "Manual Time", color: "cyan" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 63: AI completion increases velocity but can mask skill gaps
  {
    terms: [
      { text: "AI Velocity", color: "purple" },
      { text: "Skill Gaps", color: "red" },
    ],
    operators: ["+"],
    layout: "inline",
  },
  // Tip 64: Create team policy on when AI code needs extra review
  {
    terms: [
      { text: "AI Policy", color: "cyan" },
      { text: "Quality", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 65: Real AI gain is in tests and docs, not feature code
  {
    terms: [
      { text: "Tests + Docs", color: "emerald" },
      { text: "Feature Code", color: "blue" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 66: Track AI suggestions accepted vs. rejected
  {
    terms: [
      { text: "Accepted", color: "emerald" },
      { text: "Total", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 67: AI-assisted refactoring — validate with tests
  {
    terms: [
      { text: "AI Refactor", color: "purple" },
      { text: "Tests", color: "emerald" },
      { text: "Safety", color: "amber" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 68: If AI violates style guide, fix config first
  {
    terms: [
      { text: "AI Config", color: "cyan" },
      { text: "Style Guide", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 69: AI commit messages are too generic
  {
    terms: [
      { text: "AI Messages", color: "purple" },
      { text: "Human Edit", color: "emerald" },
      { text: "Clarity", color: "amber" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 70: Monitor complexity of AI code — tends verbose
  {
    terms: [
      { text: "AI Code", color: "purple" },
      { text: "Verbosity", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 71: Teams that pair AI with strong linting catch more issues
  {
    terms: [
      { text: "AI", color: "purple" },
      { text: "Linting", color: "cyan" },
      { text: "Coverage", color: "emerald" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 72: AI writes code, humans judge if it should exist
  {
    terms: [
      { text: "AI Writes", color: "purple" },
      { text: "Humans Decide", color: "emerald" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 73: Track time reviewing AI suggestions vs. writing from scratch
  {
    terms: [
      { text: "Review Time", color: "cyan" },
      { text: "Write Time", color: "blue" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 74: AI-generated tests test implementation, not contract
  {
    terms: [
      { text: "Contracts", color: "emerald" },
      { text: "Implementation", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 75: Fastest AI-adopting teams have strongest review cultures
  {
    terms: [
      { text: "AI Adoption", color: "purple" },
      { text: "Review Culture", color: "emerald" },
    ],
    operators: ["+"],
    layout: "inline",
  },
  // Tip 76: Use AI to generate PR descriptions from diffs
  {
    terms: [
      { text: "Diff", color: "blue" },
      { text: "AI", color: "purple" },
      { text: "PR Description", color: "amber" },
    ],
    operators: ["→", "→"],
    layout: "inline",
  },
  // Tip 77: AI tools most valuable in mature codebases
  {
    terms: [
      { text: "Mature Codebase", color: "emerald" },
      { text: "AI Value", color: "purple" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 78: Measure AI by accepted suggestions per day, not installs
  {
    terms: [
      { text: "Accepted", color: "emerald" },
      { text: "Day", color: "cyan" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 79: Comparing teams by raw output is misleading. Normalize.
  {
    terms: [
      { text: "Output", color: "blue" },
      { text: "Complexity", color: "purple" },
      { text: "Team Size", color: "cyan" },
    ],
    operators: ["/", "/"],
    layout: "inline",
  },
  // Tip 80: Top performer's habits should be documented and shared
  {
    terms: [
      { text: "Top Habits", color: "emerald" },
      { text: "Team Norms", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 81: One person does 60% of reviews = knowledge-sharing problem
  {
    terms: [
      { text: "Solo Reviewer", color: "red" },
      { text: "Knowledge Silo", color: "red" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 82: Gap between fastest and slowest reviewer reveals mentoring opportunities
  {
    terms: [
      { text: "Fastest", color: "emerald" },
      { text: "Slowest", color: "red" },
      { text: "Mentoring", color: "cyan" },
    ],
    operators: ["-", "→"],
    layout: "inline",
  },
  // Tip 83: Consistently low performers often lack context, not ability
  {
    terms: [
      { text: "Context", color: "emerald" },
      { text: "Ability", color: "blue" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 84: Track contribution distribution. Gini below 0.4
  {
    terms: [
      { text: "Distribution", color: "cyan" },
      { text: "Gini < 0.4", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 85: Cross-team PR reviews build shared context
  {
    terms: [
      { text: "Cross-Team", color: "cyan" },
      { text: "Reviews", color: "blue" },
      { text: "Shared Context", color: "emerald" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 86: If velocity drops after someone leaves → undocumented tribal knowledge
  {
    terms: [
      { text: "Departure", color: "red" },
      { text: "Velocity Drop", color: "red" },
      { text: "Tribal Knowledge", color: "purple" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 87: New hires who ship first PR in week one stay longer
  {
    terms: [
      { text: "Week 1 PR", color: "emerald" },
      { text: "Retention", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 88: Pair strongest reviewers with newest members
  {
    terms: [
      { text: "Senior", color: "emerald" },
      { text: "Junior", color: "cyan" },
      { text: "Growth", color: "amber" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 89: Weekly code walkthroughs → 30% fewer recurring bugs
  {
    terms: [
      { text: "Walkthroughs", color: "cyan" },
      { text: "Recurring Bugs", color: "red" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 90: Two teams own overlapping code → one stops maintaining
  {
    terms: [
      { text: "Shared Code", color: "purple" },
      { text: "Two Owners", color: "red" },
      { text: "Neglect", color: "red" },
    ],
    operators: ["+", "→"],
    layout: "inline",
  },
  // Tip 91: Track on-call burden distribution
  {
    terms: [
      { text: "On-Call Load", color: "red" },
      { text: "Team Members", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 92: Best teams have overlapping knowledge
  {
    terms: [
      { text: "Overlap", color: "emerald" },
      { text: "Silos", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 93: Senior who only writes code and never reviews is underperforming
  {
    terms: [
      { text: "Code", color: "blue" },
      { text: "Reviews", color: "cyan" },
      { text: "Senior Role", color: "amber" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 94: High-performing teams have shorter feedback loops
  {
    terms: [
      { text: "Feedback Loop", color: "cyan" },
      { text: "Performance", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 95: Hero culture = systemic failure
  {
    terms: [
      { text: "Hero Culture", color: "red" },
      { text: "System Failure", color: "red" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 96: Compare teams by outcomes, not story points
  {
    terms: [
      { text: "Outcomes", color: "emerald" },
      { text: "Story Points", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 97: Bus factor below 2 for critical system = top priority
  {
    terms: [
      { text: "Bus Factor", color: "red" },
      { text: "2", color: "amber" },
    ],
    operators: ["<"],
    layout: "inline",
  },
  // Tip 98: Rotating tech leads develop well-rounded engineers
  {
    terms: [
      { text: "Rotation", color: "cyan" },
      { text: "Growth", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 99: Track ratio of collaborative PRs to solo PRs
  {
    terms: [
      { text: "Co-authored", color: "emerald" },
      { text: "Solo PRs", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 100: A team that never disagrees isn't being honest
  {
    terms: [
      { text: "Zero Dissent", color: "red" },
      { text: "Dishonesty", color: "red" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 101: Meeting load inversely correlates with commit frequency
  {
    terms: [
      { text: "Meetings", color: "red" },
      { text: "Commits", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 102: Quietest person might be most careful reviewer
  {
    terms: [
      { text: "Quiet", color: "cyan" },
      { text: "Careful", color: "emerald" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 103: Celebrate finding bugs before production
  {
    terms: [
      { text: "Prevention", color: "emerald" },
      { text: "Fixing", color: "amber" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 104: Track mentoring hours same as coding hours
  {
    terms: [
      { text: "Mentoring", color: "cyan" },
      { text: "Coding", color: "blue" },
      { text: "Team Output", color: "amber" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 105: When strong performer's review quality drops, check workload
  {
    terms: [
      { text: "Quality Drop", color: "red" },
      { text: "Workload", color: "purple" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 106: Commit frequency is a health signal, not productivity metric
  {
    terms: [
      { text: "Commit Rhythm", color: "cyan" },
      { text: "Health", color: "emerald" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 107: Developers who commit daily ship more reliably
  {
    terms: [
      { text: "Daily Commits", color: "emerald" },
      { text: "Reliability", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 108: Drop in commit frequency precedes burnout
  {
    terms: [
      { text: "Frequency Drop", color: "red" },
      { text: "Burnout", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 109: Track first-commit-of-the-day time
  {
    terms: [
      { text: "Late Starts", color: "red" },
      { text: "Disengagement", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 110: Context switching costs 20-30 min per switch
  {
    terms: [
      { text: "Switches", color: "red" },
      { text: "30 min", color: "amber" },
      { text: "Lost Time", color: "red" },
    ],
    operators: ["×", "="],
    layout: "inline",
  },
  // Tip 111: Long-lived feature branches are productivity killers
  {
    terms: [
      { text: "Trunk-Based", color: "emerald" },
      { text: "Long Branches", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 112: PR size doubles overnight → batching from friction
  {
    terms: [
      { text: "PR Size", color: "red" },
      { text: "Process Friction", color: "purple" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 113: Focus time correlates with higher code quality
  {
    terms: [
      { text: "Focus Time", color: "emerald" },
      { text: "Code Quality", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 114: Gap between PR submission and first review = idle time
  {
    terms: [
      { text: "Submit", color: "blue" },
      { text: "Review", color: "cyan" },
      { text: "Idle Time", color: "red" },
    ],
    operators: ["→", "="],
    layout: "inline",
  },
  // Tip 115: Developers who write tests first have fewer reverts
  {
    terms: [
      { text: "Tests First", color: "emerald" },
      { text: "Reverts", color: "red" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 116: Weekend commits = burnout signal
  {
    terms: [
      { text: "Weekend Work", color: "red" },
      { text: "Dedication", color: "blue" },
    ],
    operators: ["≠"],
    layout: "inline",
  },
  // Tip 117: Velocity spikes before deadlines then crashes
  {
    terms: [
      { text: "Sprint", color: "amber" },
      { text: "Crash", color: "red" },
      { text: "Unsustainable", color: "red" },
    ],
    operators: ["→", "="],
    layout: "inline",
  },
  // Tip 118: Track cycle time from first commit to production deploy
  {
    terms: [
      { text: "First Commit", color: "blue" },
      { text: "Production", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 119: High commit frequency but low merge rate = stuck in review
  {
    terms: [
      { text: "Commits", color: "blue" },
      { text: "Merges", color: "emerald" },
      { text: "Review Limbo", color: "red" },
    ],
    operators: ["-", "="],
    layout: "inline",
  },
  // Tip 120: Measure wait time in pipeline: review, CI, deploy waits
  {
    terms: [
      { text: "Wait Time", color: "red" },
      { text: "Pipeline", color: "cyan" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 121: If fastest dev is 10x, ask what slows everyone else
  {
    terms: [
      { text: "10x Dev", color: "emerald" },
      { text: "Blockers", color: "red" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 122: Consistency beats intensity
  {
    terms: [
      { text: "Consistency", color: "emerald" },
      { text: "Intensity", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 123: Track how long from idea to first commit
  {
    terms: [
      { text: "Idea", color: "purple" },
      { text: "First Commit", color: "blue" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 124: Developer touching too many repos is spread too thin
  {
    terms: [
      { text: "Many Repos", color: "red" },
      { text: "Focus", color: "emerald" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 125: Late-night commits correlate with higher bug rates
  {
    terms: [
      { text: "Late Night", color: "red" },
      { text: "Bug Rate", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 126: Best productivity intervention is removing one meeting
  {
    terms: [
      { text: "Meetings", color: "red" },
      { text: "Productivity", color: "emerald" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 127: Deployment frequency below once a week → find bottleneck
  {
    terms: [
      { text: "Deploy Freq", color: "blue" },
      { text: "Weekly", color: "amber" },
    ],
    operators: ["<"],
    layout: "inline",
  },
  // Tip 128: Track time on review vs writing code. 20-30% on reviews
  {
    terms: [
      { text: "Review Time", color: "cyan" },
      { text: "Coding Time", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 129: Auto-merge for trivial changes frees review bandwidth
  {
    terms: [
      { text: "Auto-Merge", color: "cyan" },
      { text: "Trivial", color: "blue" },
      { text: "Bandwidth", color: "emerald" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 130: IDE time vs meeting time. Below 50% coding = process bloat
  {
    terms: [
      { text: "IDE Time", color: "emerald" },
      { text: "Meeting Time", color: "red" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 131: Developer who refactors before adding features saves future hours
  {
    terms: [
      { text: "Refactor First", color: "emerald" },
      { text: "Future Savings", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 132: Commit count is vanity. Impact per commit matters.
  {
    terms: [
      { text: "Impact", color: "amber" },
      { text: "Commits", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 133: DORA metrics are a starting point
  {
    terms: [
      { text: "DORA", color: "cyan" },
      { text: "Context", color: "purple" },
      { text: "Insight", color: "amber" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 134: Track deployment frequency, lead time, CFR, recovery time together
  {
    terms: [
      { text: "Frequency", color: "blue" },
      { text: "Lead Time", color: "cyan" },
      { text: "CFR", color: "red" },
      { text: "Recovery", color: "emerald" },
    ],
    operators: ["+", "+", "+"],
    layout: "inline",
  },
  // Tip 135: A dashboard nobody checks is worse than none
  {
    terms: [
      { text: "Dashboard", color: "cyan" },
      { text: "Engagement", color: "emerald" },
    ],
    operators: ["×"],
    layout: "inline",
  },
  // Tip 136: Velocity without quality incentivizes wrong behavior
  {
    terms: [
      { text: "Velocity", color: "blue" },
      { text: "Quality", color: "emerald" },
      { text: "Value", color: "amber" },
    ],
    operators: ["×", "="],
    layout: "inline",
  },
  // Tip 137: Most dangerous metric is one optimized at expense of everything
  {
    terms: [
      { text: "One Metric", color: "red" },
      { text: "Everything Else", color: "emerald" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 138: Track ratio of feature work to maintenance
  {
    terms: [
      { text: "Features", color: "blue" },
      { text: "Maintenance", color: "amber" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 139: Story points measure effort, not value
  {
    terms: [
      { text: "Effort", color: "blue" },
      { text: "Value", color: "amber" },
    ],
    operators: ["≠"],
    layout: "inline",
  },
  // Tip 140: If metrics don't change behavior, they're decorative
  {
    terms: [
      { text: "Metrics", color: "cyan" },
      { text: "Behavior Change", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 141: MTTR matters more than MTBF for mature teams
  {
    terms: [
      { text: "Recovery", color: "emerald" },
      { text: "Prevention", color: "blue" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 142: Track percentage of unplanned work. Above 30% = planning is off
  {
    terms: [
      { text: "Unplanned", color: "red" },
      { text: "Total Work", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 143: Measure rework rate — code changed within two weeks
  {
    terms: [
      { text: "Rework", color: "red" },
      { text: "Total Changes", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 144: Best metrics are ones the team agrees are fair
  {
    terms: [
      { text: "Fair Metrics", color: "emerald" },
      { text: "Team Trust", color: "amber" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 145: High deploy frequency with high CFR = shipping bugs faster
  {
    terms: [
      { text: "Deploys", color: "blue" },
      { text: "Failures", color: "red" },
      { text: "Faster Bugs", color: "red" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 146: Track PR throughput per week as a team
  {
    terms: [
      { text: "Team PRs", color: "blue" },
      { text: "Week", color: "cyan" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 147: Impact score should weigh complexity, risk, business value
  {
    terms: [
      { text: "Complexity", color: "purple" },
      { text: "Risk", color: "red" },
      { text: "Value", color: "amber" },
    ],
    operators: ["×", "×"],
    layout: "inline",
  },
  // Tip 148: If you can't explain a metric in one sentence, drop it
  {
    terms: [
      { text: "Clarity", color: "emerald" },
      { text: "Metric Value", color: "amber" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 149: Leading indicators beat lagging indicators
  {
    terms: [
      { text: "Leading", color: "emerald" },
      { text: "Lagging", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 150: Benchmark against your own past performance
  {
    terms: [
      { text: "Past Self", color: "emerald" },
      { text: "Others", color: "blue" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 151: Track developer-initiated vs externally-requested work
  {
    terms: [
      { text: "Dev-Initiated", color: "emerald" },
      { text: "Requested", color: "blue" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 152: Measure time for feature to reach 90% of users after merge
  {
    terms: [
      { text: "Merge", color: "blue" },
      { text: "90% Reach", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 153: Dashboard with more than 7 metrics → nobody reads all
  {
    terms: [
      { text: "Metrics", color: "cyan" },
      { text: "7", color: "amber" },
    ],
    operators: ["≤"],
    layout: "inline",
  },
  // Tip 154: Track age of oldest open PR
  {
    terms: [
      { text: "PR Age", color: "red" },
      { text: "Bottleneck", color: "purple" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 155: Metric targets should be ranges, not exact numbers
  {
    terms: [
      { text: "Ranges", color: "emerald" },
      { text: "Exact Targets", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 156: Best metric for team health = would they recommend the team
  {
    terms: [
      { text: "Recommend?", color: "emerald" },
      { text: "Team Health", color: "amber" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 157: Track escaped defects
  {
    terms: [
      { text: "Escaped Bugs", color: "red" },
      { text: "Total Bugs", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 158: Every AI PR should be tagged
  {
    terms: [
      { text: "AI PRs", color: "purple" },
      { text: "Tag", color: "cyan" },
      { text: "Track", color: "amber" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 159: Set governance before AI scales
  {
    terms: [
      { text: "Policy First", color: "emerald" },
      { text: "Scale Second", color: "purple" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 160: Track % of AI code that passes review first try
  {
    terms: [
      { text: "AI First Pass", color: "purple" },
      { text: "Total AI PRs", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 161: AI code in security areas needs extra reviewer
  {
    terms: [
      { text: "AI + Security", color: "red" },
      { text: "Extra Review", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 162: Velocity gains from AI mean nothing if CFR rises
  {
    terms: [
      { text: "AI Speed", color: "purple" },
      { text: "Failure Rate", color: "red" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 163: Create AI usage policy per repo and file type
  {
    terms: [
      { text: "AI Policy", color: "cyan" },
      { text: "Repo", color: "blue" },
      { text: "File Type", color: "purple" },
    ],
    operators: ["×", "×"],
    layout: "inline",
  },
  // Tip 164: Review burden increases with AI adoption
  {
    terms: [
      { text: "AI Adoption", color: "purple" },
      { text: "Review Load", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 165: Track revert rates for AI commits separately
  {
    terms: [
      { text: "AI Reverts", color: "red" },
      { text: "AI Commits", color: "purple" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 166: AI governance = quality at higher velocity
  {
    terms: [
      { text: "Governance", color: "cyan" },
      { text: "Quality", color: "emerald" },
      { text: "Velocity", color: "blue" },
    ],
    operators: ["=", "×"],
    layout: "inline",
  },
  // Tip 167: AI bypassing tests = CI gap
  {
    terms: [
      { text: "AI Code", color: "purple" },
      { text: "Tests", color: "red" },
      { text: "CI Gap", color: "red" },
    ],
    operators: ["without", "="],
    layout: "inline",
  },
  // Tip 168: Governance-velocity balance is key calibration
  {
    terms: [
      { text: "Governance", color: "cyan" },
      { text: "Velocity", color: "blue" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 169: AI code must meet same review standards. No exceptions.
  {
    terms: [
      { text: "AI Standards", color: "purple" },
      { text: "Human Standards", color: "emerald" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 170: Track AI tool versions across team
  {
    terms: [
      { text: "Consistent Tools", color: "cyan" },
      { text: "Consistent Output", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 171: Audit AI code for license compliance
  {
    terms: [
      { text: "AI Code", color: "purple" },
      { text: "License Audit", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 172: Monitor which devs override AI suggestions most
  {
    terms: [
      { text: "Overrides", color: "amber" },
      { text: "Insights", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 173: AI docs should be verified by feature owner
  {
    terms: [
      { text: "AI Docs", color: "purple" },
      { text: "Owner Verify", color: "emerald" },
    ],
    operators: ["+"],
    layout: "inline",
  },
  // Tip 174: Track mean time to detect issues in AI vs human code
  {
    terms: [
      { text: "AI Detect Time", color: "purple" },
      { text: "Human Detect", color: "cyan" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 175: AI governance should evolve quarterly
  {
    terms: [
      { text: "Policy", color: "cyan" },
      { text: "Quarter", color: "amber" },
      { text: "Evolve", color: "emerald" },
    ],
    operators: ["/", "→"],
    layout: "inline",
  },
  // Tip 176: AI PRs with lower review engagement = overtrust
  {
    terms: [
      { text: "AI Trust", color: "purple" },
      { text: "Review Depth", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 177: Separate dashboards for AI vs manual workflows
  {
    terms: [
      { text: "AI Metrics", color: "purple" },
      { text: "Manual Metrics", color: "cyan" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 178: AI without architecture awareness = locally correct, globally incoherent
  {
    terms: [
      { text: "AI Code", color: "purple" },
      { text: "Architecture", color: "red" },
      { text: "Incoherence", color: "red" },
    ],
    operators: ["without", "="],
    layout: "inline",
  },
  // Tip 179: Track how AI affects review depth
  {
    terms: [
      { text: "AI Volume", color: "blue" },
      { text: "Review Depth", color: "emerald" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 180: Ban AI code in incident response
  {
    terms: [
      { text: "Incidents", color: "red" },
      { text: "AI Code", color: "purple" },
    ],
    operators: ["without"],
    layout: "inline",
  },
  // Tip 181: Measure AI code that survives 6 months without modification
  {
    terms: [
      { text: "AI Longevity", color: "purple" },
      { text: "6 Months", color: "amber" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 182: AI governance should include rollback for tool outages
  {
    terms: [
      { text: "AI Outage", color: "red" },
      { text: "Rollback Plan", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 183: If AI generates tests, who tests the tests?
  {
    terms: [
      { text: "AI Tests", color: "purple" },
      { text: "Validation", color: "emerald" },
      { text: "Ownership", color: "amber" },
    ],
    operators: ["→", "→"],
    layout: "inline",
  },
  // Tip 184: Best hiring signal is how they talk about failures
  {
    terms: [
      { text: "Failures Shared", color: "emerald" },
      { text: "Successes Told", color: "blue" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 185: Onboarding should include a curated first PR
  {
    terms: [
      { text: "First PR", color: "emerald" },
      { text: "Docs Only", color: "blue" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 186: New hire's first week should end with a shipped change
  {
    terms: [
      { text: "Week 1", color: "cyan" },
      { text: "Shipped", color: "emerald" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 187: Knowledge sharing is a performance criterion for seniors
  {
    terms: [
      { text: "Sharing", color: "emerald" },
      { text: "Senior Role", color: "amber" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 188: Track time for new hires to first unassisted deploy
  {
    terms: [
      { text: "Hire Date", color: "cyan" },
      { text: "Solo Deploy", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 189: Best tech leads write less code and enable more people
  {
    terms: [
      { text: "Enabling", color: "emerald" },
      { text: "Coding", color: "blue" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 190: Architecture decisions not documented will be reversed
  {
    terms: [
      { text: "Decisions", color: "purple" },
      { text: "Docs", color: "cyan" },
      { text: "Longevity", color: "amber" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 191: Blameless postmortems within 48 hours
  {
    terms: [
      { text: "Incident", color: "red" },
      { text: "48 Hours", color: "amber" },
      { text: "Postmortem", color: "cyan" },
    ],
    operators: ["→", "→"],
    layout: "inline",
  },
  // Tip 192: Invest in dev tools proportional to team size
  {
    terms: [
      { text: "Dev Tools", color: "cyan" },
      { text: "Team Size", color: "blue" },
    ],
    operators: ["×"],
    layout: "inline",
  },
  // Tip 193: Tech debt should have dedicated budget
  {
    terms: [
      { text: "Debt Budget", color: "amber" },
      { text: "Feature Budget", color: "blue" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 194: Most valuable tech lead skill is saying no
  {
    terms: [
      { text: "Right No", color: "emerald" },
      { text: "Right Time", color: "amber" },
    ],
    operators: ["×"],
    layout: "inline",
  },
  // Tip 195: Onboarding time-to-productivity. Over 90 days = simplify
  {
    terms: [
      { text: "Onboarding", color: "cyan" },
      { text: "90 Days", color: "amber" },
    ],
    operators: ["<"],
    layout: "inline",
  },
  // Tip 196: Managers who stop reading code lose ability to evaluate
  {
    terms: [
      { text: "Read Code", color: "emerald" },
      { text: "Lead Well", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 197: Create a decision log for architectural choices
  {
    terms: [
      { text: "Decision Log", color: "cyan" },
      { text: "Future Clarity", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 198: Best teams have explicit documented coding standards
  {
    terms: [
      { text: "Standards", color: "emerald" },
      { text: "Written", color: "cyan" },
      { text: "Consistent", color: "amber" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 199: Succession planning — no single departure delays more than a sprint
  {
    terms: [
      { text: "Departure", color: "red" },
      { text: "Delay", color: "amber" },
      { text: "1 Sprint", color: "emerald" },
    ],
    operators: ["→", "≤"],
    layout: "inline",
  },
  // Tip 200: Team leads spending 30%+ in meetings can't lead technically
  {
    terms: [
      { text: "Meetings", color: "red" },
      { text: "Tech Time", color: "emerald" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 201: Hire for team gaps, not candidate strengths
  {
    terms: [
      { text: "Team Gaps", color: "amber" },
      { text: "Star Power", color: "blue" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 202: Good EM knows difference between slow week and systemic problem
  {
    terms: [
      { text: "Slow Week", color: "blue" },
      { text: "Systemic Issue", color: "red" },
    ],
    operators: ["≠"],
    layout: "inline",
  },
  // Tip 203: Invest in writing culture
  {
    terms: [
      { text: "Writing", color: "emerald" },
      { text: "Predictability", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 204: Track internal tech talks per quarter
  {
    terms: [
      { text: "Tech Talks", color: "cyan" },
      { text: "Quarter", color: "amber" },
      { text: "Knowledge", color: "emerald" },
    ],
    operators: ["/", "="],
    layout: "inline",
  },
  // Tip 205: Architecture should make right thing easy, wrong thing hard
  {
    terms: [
      { text: "Right Path", color: "emerald" },
      { text: "Wrong Path", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 206: Leaders who never pair-program miss critical context
  {
    terms: [
      { text: "Pairing", color: "cyan" },
      { text: "Context", color: "purple" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 207: Make on-call a learning experience
  {
    terms: [
      { text: "On-Call", color: "amber" },
      { text: "Learning", color: "emerald" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 208: Cost of bad hire = 6-12 months of disruption
  {
    terms: [
      { text: "Bad Hire", color: "red" },
      { text: "12 Months", color: "red" },
    ],
    operators: ["×"],
    layout: "inline",
  },
  // Tip 209: If team can't explain architecture in 5 min, too complex
  {
    terms: [
      { text: "Architecture", color: "purple" },
      { text: "5 Minutes", color: "amber" },
    ],
    operators: ["≤"],
    layout: "inline",
  },
  // Tip 210: Promote engineers who elevate others
  {
    terms: [
      { text: "Elevate Others", color: "emerald" },
      { text: "Ship Most", color: "blue" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 211: Review design before code
  {
    terms: [
      { text: "Design", color: "purple" },
      { text: "Code", color: "blue" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 212: Limit code reviews to 60 minutes
  {
    terms: [
      { text: "Review", color: "cyan" },
      { text: "60 Min", color: "amber" },
    ],
    operators: ["≤"],
    layout: "inline",
  },
  // Tip 213: Use a review checklist for critical paths
  {
    terms: [
      { text: "Checklist", color: "cyan" },
      { text: "Critical Path", color: "red" },
      { text: "Safety", color: "emerald" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 214: Nitpicks should be labeled. Don't block for style.
  {
    terms: [
      { text: "Nitpicks", color: "blue" },
      { text: "Blockers", color: "red" },
    ],
    operators: ["≠"],
    layout: "inline",
  },
  // Tip 215: Ask "what happens if this fails?" on every error path
  {
    terms: [
      { text: "Failure Path", color: "red" },
      { text: "Bugs", color: "red" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 216: Review tests first
  {
    terms: [
      { text: "Tests", color: "emerald" },
      { text: "Implementation", color: "blue" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 217: Approve with comments for minor changes
  {
    terms: [
      { text: "Minor Fix", color: "blue" },
      { text: "Approve + Note", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 218: Track questions vs suggestions vs requirements in reviews
  {
    terms: [
      { text: "Questions", color: "cyan" },
      { text: "Suggestions", color: "amber" },
      { text: "Requirements", color: "red" },
    ],
    operators: [":", ":"],
    layout: "inline",
  },
  // Tip 219: Reviewer's job is to understand, not rewrite
  {
    terms: [
      { text: "Understand", color: "emerald" },
      { text: "Rewrite", color: "red" },
    ],
    operators: ["≠"],
    layout: "inline",
  },
  // Tip 220: Can't review in 30 min = PR too large
  {
    terms: [
      { text: "Review Time", color: "cyan" },
      { text: "30 Min", color: "amber" },
    ],
    operators: ["≤"],
    layout: "inline",
  },
  // Tip 221: Automate style enforcement. Humans review logic.
  {
    terms: [
      { text: "Style", color: "cyan" },
      { text: "Automation", color: "blue" },
      { text: "Logic", color: "emerald" },
    ],
    operators: ["→", ":"],
    layout: "inline",
  },
  // Tip 222: Leave one positive comment per review
  {
    terms: [
      { text: "Praise", color: "emerald" },
      { text: "Trust", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 223: Review PRs in submission order
  {
    terms: [
      { text: "FIFO", color: "cyan" },
      { text: "Fairness", color: "emerald" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 224: "Minor changes" + 500 lines = push back
  {
    terms: [
      { text: "\"Minor\"", color: "red" },
      { text: "500 Lines", color: "red" },
    ],
    operators: ["+"],
    layout: "inline",
  },
  // Tip 225: Require local run for changes above 200 lines
  {
    terms: [
      { text: "200+ Lines", color: "blue" },
      { text: "Local Run", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 226: Don't approve code you don't understand
  {
    terms: [
      { text: "Understanding", color: "emerald" },
      { text: "Approval", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 227: Track reviewed code incidents vs unreviewed
  {
    terms: [
      { text: "Reviewed", color: "emerald" },
      { text: "Unreviewed", color: "red" },
      { text: "Incidents", color: "red" },
    ],
    operators: [":", "→"],
    layout: "inline",
  },
  // Tip 228: Use PR templates
  {
    terms: [
      { text: "Templates", color: "cyan" },
      { text: "Context", color: "emerald" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 229: Best review comment teaches. Worst says "change this."
  {
    terms: [
      { text: "Teaching", color: "emerald" },
      { text: "Commanding", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 230: Review for missing code as much as existing
  {
    terms: [
      { text: "What's Missing", color: "amber" },
      { text: "What's There", color: "blue" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 231: Encourage self-review before requesting others
  {
    terms: [
      { text: "Self-Review", color: "emerald" },
      { text: "30% Fewer Issues", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 232: Set review SLAs: 4h small, 24h large
  {
    terms: [
      { text: "Small PR", color: "blue" },
      { text: "4 Hours", color: "cyan" },
      { text: "Large PR", color: "purple" },
      { text: "24 Hours", color: "amber" },
    ],
    operators: ["→", ":", "→"],
    layout: "inline",
  },
  // Tip 233: Rotating review assignments prevent silos
  {
    terms: [
      { text: "Rotation", color: "cyan" },
      { text: "Silos", color: "red" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 234: Always approves without comments = rubber stamping
  {
    terms: [
      { text: "No Comments", color: "red" },
      { text: "Rubber Stamp", color: "red" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 235: Code review is a conversation
  {
    terms: [
      { text: "Conversation", color: "emerald" },
      { text: "Gatekeeping", color: "red" },
    ],
    operators: ["≠"],
    layout: "inline",
  },
  // Tip 236: Track average review iterations. More than 3 = misalignment
  {
    terms: [
      { text: "Iterations", color: "cyan" },
      { text: "3", color: "amber" },
    ],
    operators: ["≤"],
    layout: "inline",
  },
  // Tip 237: Track repos with highest incident rate
  {
    terms: [
      { text: "Incidents", color: "red" },
      { text: "Repo", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 238: Every incident should produce an automated check
  {
    terms: [
      { text: "Incident", color: "red" },
      { text: "Auto Check", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 239: Deploy frequency vs incident frequency correlation
  {
    terms: [
      { text: "Deploys", color: "blue" },
      { text: "Incidents", color: "red" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 240: Friday deploys are riskiest
  {
    terms: [
      { text: "Friday Deploy", color: "red" },
      { text: "Risk", color: "red" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 241: Rollback should take under 5 minutes
  {
    terms: [
      { text: "Rollback", color: "amber" },
      { text: "5 Min", color: "emerald" },
    ],
    operators: ["<"],
    layout: "inline",
  },
  // Tip 242: Track hotfixes per sprint. More than two = quality problem
  {
    terms: [
      { text: "Hotfixes", color: "red" },
      { text: "Sprint", color: "cyan" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 243: Feature flags reduce deploy risk
  {
    terms: [
      { text: "Feature Flags", color: "emerald" },
      { text: "Deploy Risk", color: "red" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 244: Most dangerous change is one everyone assumes safe
  {
    terms: [
      { text: "\"Trivial\"", color: "red" },
      { text: "Hidden Risk", color: "red" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 245: Track MTTD not just MTTR
  {
    terms: [
      { text: "Detection", color: "emerald" },
      { text: "Resolution", color: "amber" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 246: Canary deployments catch issues early
  {
    terms: [
      { text: "Canary", color: "emerald" },
      { text: "Full Deploy", color: "blue" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 247: On-call can't diagnose without author = docs lacking
  {
    terms: [
      { text: "On-Call", color: "amber" },
      { text: "Author", color: "red" },
      { text: "Docs Gap", color: "red" },
    ],
    operators: ["-", "="],
    layout: "inline",
  },
  // Tip 248: Track which change types cause most incidents
  {
    terms: [
      { text: "Change Type", color: "purple" },
      { text: "Incident Rate", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 249: Rising escaped defects = safety net holes
  {
    terms: [
      { text: "Escaped Defects", color: "red" },
      { text: "Safety Gaps", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 250: Run chaos engineering exercises quarterly
  {
    terms: [
      { text: "Chaos Tests", color: "purple" },
      { text: "Resilience", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 251: Track incidents from direct pushes vs reviewed PRs
  {
    terms: [
      { text: "Direct Push", color: "red" },
      { text: "Reviewed PR", color: "emerald" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 252: CFR exceeds 15% → slow down
  {
    terms: [
      { text: "Failure Rate", color: "red" },
      { text: "15%", color: "amber" },
      { text: "Slow Down", color: "emerald" },
    ],
    operators: [">", "→"],
    layout: "inline",
  },
  // Tip 253: Monitor dependency vulnerabilities weekly
  {
    terms: [
      { text: "Vulnerabilities", color: "red" },
      { text: "Week", color: "cyan" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 254: Track age of oldest unresolved security finding
  {
    terms: [
      { text: "Finding Age", color: "red" },
      { text: "Attacker Advantage", color: "red" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 255: Require rollback plan for every deploy
  {
    terms: [
      { text: "Deploy", color: "blue" },
      { text: "Rollback Plan", color: "emerald" },
    ],
    operators: ["+"],
    layout: "inline",
  },
  // Tip 256: Post-incident reviews without action items = storytelling
  {
    terms: [
      { text: "Review", color: "cyan" },
      { text: "Action Items", color: "red" },
      { text: "Storytelling", color: "red" },
    ],
    operators: ["without", "="],
    layout: "inline",
  },
  // Tip 257: Track predictable incidents from monitoring data
  {
    terms: [
      { text: "Predicted", color: "emerald" },
      { text: "Surprised", color: "red" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 258: Load test before major launches
  {
    terms: [
      { text: "Load Test", color: "emerald" },
      { text: "Launch", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 259: More than 5 false positives/week → alert fatigue
  {
    terms: [
      { text: "False Alerts", color: "red" },
      { text: "Alert Fatigue", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 260: Track proactive vs reactive fixes
  {
    terms: [
      { text: "Proactive", color: "emerald" },
      { text: "Reactive", color: "red" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 261: Every critical path needs 2 engineers who can debug at 3 AM
  {
    terms: [
      { text: "Critical Path", color: "red" },
      { text: "2 Experts", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 262: Best incident prevention = reduce blast radius
  {
    terms: [
      { text: "Blast Radius", color: "red" },
      { text: "Prevention", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 263: If not documented, it doesn't exist
  {
    terms: [
      { text: "Docs", color: "cyan" },
      { text: "Existence", color: "amber" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 264: Outdated docs worse than no docs
  {
    terms: [
      { text: "Stale Docs", color: "red" },
      { text: "No Docs", color: "amber" },
    ],
    operators: ["<"],
    layout: "inline",
  },
  // Tip 265: Every API endpoint should have understandable docs
  {
    terms: [
      { text: "API", color: "blue" },
      { text: "Clear Docs", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 266: README should answer: what, how to run, who owns
  {
    terms: [
      { text: "What", color: "blue" },
      { text: "How", color: "cyan" },
      { text: "Who", color: "amber" },
    ],
    operators: ["+", "+"],
    layout: "inline",
  },
  // Tip 267: Track doc updates alongside code changes
  {
    terms: [
      { text: "Code Change", color: "blue" },
      { text: "Doc Update", color: "cyan" },
    ],
    operators: ["+"],
    layout: "inline",
  },
  // Tip 268: ADRs cost 30 min, save weeks of debate
  {
    terms: [
      { text: "30 Min", color: "cyan" },
      { text: "Weeks Saved", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 269: Onboarding requires specific person = not documented
  {
    terms: [
      { text: "Person-Dependent", color: "red" },
      { text: "Documented", color: "emerald" },
    ],
    operators: ["≠"],
    layout: "inline",
  },
  // Tip 270: Runbooks should be tested quarterly
  {
    terms: [
      { text: "Untested Runbook", color: "red" },
      { text: "False Security", color: "red" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 271: Track which docs get most views
  {
    terms: [
      { text: "Doc Views", color: "blue" },
      { text: "Real Needs", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 272: Inline comments explain why, not what
  {
    terms: [
      { text: "Why", color: "emerald" },
      { text: "What", color: "blue" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 273: Auto-generate API docs from annotations
  {
    terms: [
      { text: "Annotations", color: "blue" },
      { text: "Auto Docs", color: "cyan" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 274: Every postmortem should update relevant runbook
  {
    terms: [
      { text: "Postmortem", color: "red" },
      { text: "Runbook Update", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 275: Time between code change and doc update. Same-day = goal
  {
    terms: [
      { text: "Code Δ", color: "blue" },
      { text: "Doc Δ", color: "cyan" },
      { text: "Same Day", color: "emerald" },
    ],
    operators: ["→", "="],
    layout: "inline",
  },
  // Tip 276: Doc PRs reviewed with same rigor as code PRs
  {
    terms: [
      { text: "Doc Review", color: "cyan" },
      { text: "Code Review", color: "blue" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 277: Dev searches docs, finds nothing = documentation bug
  {
    terms: [
      { text: "Search Miss", color: "red" },
      { text: "Doc Bug", color: "red" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 278: Create a glossary. Jargon = enemy of onboarding
  {
    terms: [
      { text: "Glossary", color: "cyan" },
      { text: "Jargon", color: "red" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 279: Track knowledge bus factor per service
  {
    terms: [
      { text: "Knowledge", color: "purple" },
      { text: "People", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 280: Video walkthroughs 10x more effective for onboarding
  {
    terms: [
      { text: "Video", color: "emerald" },
      { text: "10×", color: "amber" },
      { text: "Written Docs", color: "blue" },
    ],
    operators: ["=", "×"],
    layout: "inline",
  },
  // Tip 281: Treat internal docs like a product
  {
    terms: [
      { text: "Docs", color: "cyan" },
      { text: "Product", color: "amber" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 282: Decision logs prevent recurring debates
  {
    terms: [
      { text: "Decision Log", color: "cyan" },
      { text: "Repeat Debates", color: "red" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 283: Every service should have one-page architecture overview
  {
    terms: [
      { text: "Service", color: "blue" },
      { text: "One Page", color: "cyan" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 284: 10% of time answering same questions = write a FAQ
  {
    terms: [
      { text: "Same Questions", color: "red" },
      { text: "FAQ", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 285: Link code comments to design docs
  {
    terms: [
      { text: "Code", color: "blue" },
      { text: "Design Docs", color: "cyan" },
      { text: "Context", color: "emerald" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 286: Track Slack questions answerable by existing docs
  {
    terms: [
      { text: "Slack Q's", color: "red" },
      { text: "Docs Gap", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 287: Deprecation notices should include migration guides
  {
    terms: [
      { text: "Deprecation", color: "red" },
      { text: "Migration Guide", color: "emerald" },
    ],
    operators: ["+"],
    layout: "inline",
  },
  // Tip 288: Best docs written by someone who just learned the system
  {
    terms: [
      { text: "Fresh Eyes", color: "emerald" },
      { text: "Expert Eyes", color: "blue" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 289: CI > 15 min → context switching
  {
    terms: [
      { text: "CI Time", color: "red" },
      { text: "Focus Loss", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 290: Track flaky test rates. Above 2% erodes trust
  {
    terms: [
      { text: "Flaky Tests", color: "red" },
      { text: "Suite Trust", color: "emerald" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 291: Failed builds should produce actionable errors
  {
    terms: [
      { text: "Clear Error", color: "emerald" },
      { text: "Stack Trace", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 292: Measure time from merge to production
  {
    terms: [
      { text: "Merge", color: "blue" },
      { text: "Production", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 293: More than 3 commands to set up = simplify
  {
    terms: [
      { text: "Setup Steps", color: "red" },
      { text: "3", color: "amber" },
    ],
    operators: ["≤"],
    layout: "inline",
  },
  // Tip 294: Track re-runs due to flaky failures = wasted time
  {
    terms: [
      { text: "CI Re-runs", color: "red" },
      { text: "Wasted Time", color: "red" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 295: Cache aggressively in CI
  {
    terms: [
      { text: "Caching", color: "emerald" },
      { text: "Build Speed", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 296: Run CI checks on every push, not just merge
  {
    terms: [
      { text: "Every Push", color: "emerald" },
      { text: "Merge Only", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 297: Track fully automated vs manual deployments
  {
    terms: [
      { text: "Automated", color: "emerald" },
      { text: "Manual Steps", color: "red" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 298: Monitor build queue wait times
  {
    terms: [
      { text: "Queue Time", color: "red" },
      { text: "CI Capacity", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 299: Parallelize test suites
  {
    terms: [
      { text: "Parallel", color: "emerald" },
      { text: "Serial", color: "red" },
      { text: "4× Faster", color: "amber" },
    ],
    operators: [">", "="],
    layout: "inline",
  },
  // Tip 300: Track which CI steps fail most
  {
    terms: [
      { text: "Top Failures", color: "red" },
      { text: "Fix First", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 301: Preview environments for every PR
  {
    terms: [
      { text: "Preview Env", color: "cyan" },
      { text: "Review Quality", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 302: Deploy requires specific person's credentials = SPOF
  {
    terms: [
      { text: "One Person", color: "red" },
      { text: "Deploy", color: "blue" },
      { text: "SPOF", color: "red" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 303: Measure developer satisfaction with CI/CD quarterly
  {
    terms: [
      { text: "DX Score", color: "emerald" },
      { text: "Quarter", color: "cyan" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 304: Track deploys rolled back within an hour
  {
    terms: [
      { text: "Rollbacks", color: "red" },
      { text: "1 Hour", color: "amber" },
    ],
    operators: ["<"],
    layout: "inline",
  },
  // Tip 305: Confident developers deploy more often
  {
    terms: [
      { text: "Confidence", color: "emerald" },
      { text: "Deploy Freq", color: "blue" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 306: Auto-format on commit so CI never fails for style
  {
    terms: [
      { text: "Auto-Format", color: "cyan" },
      { text: "Style Fails", color: "red" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 307: Staging ≠ production = false confidence
  {
    terms: [
      { text: "Staging", color: "amber" },
      { text: "Production", color: "blue" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 308: "Works on my machine" vs "works in CI" gap
  {
    terms: [
      { text: "Local", color: "blue" },
      { text: "CI", color: "cyan" },
      { text: "Parity", color: "emerald" },
    ],
    operators: ["=", "→"],
    layout: "inline",
  },
  // Tip 309: Every team should own their deployment pipeline
  {
    terms: [
      { text: "Team Pipeline", color: "emerald" },
      { text: "Shared Pipeline", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 310: Measure build time vs test time ratio
  {
    terms: [
      { text: "Build Time", color: "blue" },
      { text: "Test Time", color: "cyan" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 311: Feature flag cleanup should be part of CI
  {
    terms: [
      { text: "Stale Flags", color: "red" },
      { text: "CI Check", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 312: Config changes requiring full redeploy. Zero = goal
  {
    terms: [
      { text: "Config Deploys", color: "red" },
      { text: "Zero", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 313: DX is a retention strategy
  {
    terms: [
      { text: "Dev Experience", color: "emerald" },
      { text: "Retention", color: "amber" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 314: New microservice > 1 day setup = invest in templates
  {
    terms: [
      { text: "Service Setup", color: "cyan" },
      { text: "1 Day", color: "amber" },
    ],
    operators: ["≤"],
    layout: "inline",
  },
  // Tip 315: Track tech debt as first-class backlog item
  {
    terms: [
      { text: "Tech Debt", color: "red" },
      { text: "Backlog Item", color: "cyan" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 316: Allocate 20% of sprint to tech debt
  {
    terms: [
      { text: "Debt Work", color: "red" },
      { text: "Sprint", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 317: Best time to refactor is during a feature change
  {
    terms: [
      { text: "Feature Work", color: "blue" },
      { text: "Refactor", color: "emerald" },
    ],
    operators: ["+"],
    layout: "inline",
  },
  // Tip 318: TODO older than a year is a lie
  {
    terms: [
      { text: "TODO Age", color: "red" },
      { text: "1 Year", color: "amber" },
      { text: "Lie", color: "red" },
    ],
    operators: [">", "="],
    layout: "inline",
  },
  // Tip 319: Refactoring without tests = hoping
  {
    terms: [
      { text: "Refactor", color: "purple" },
      { text: "Tests", color: "red" },
      { text: "Hope", color: "red" },
    ],
    operators: ["without", "="],
    layout: "inline",
  },
  // Tip 320: Measure time-to-modify for most-changed files
  {
    terms: [
      { text: "Modify Time", color: "red" },
      { text: "Debt Signal", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 321: Refactor must improve something measurable
  {
    terms: [
      { text: "Refactor", color: "purple" },
      { text: "Measurable Gain", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 322: Track sprint time spent working around tech debt
  {
    terms: [
      { text: "Workaround Time", color: "red" },
      { text: "Sprint Time", color: "blue" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 323: Large refactors in incremental PRs, not big bang
  {
    terms: [
      { text: "Incremental", color: "emerald" },
      { text: "Big Bang", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 324: Monitor dependency age
  {
    terms: [
      { text: "Dep Age", color: "red" },
      { text: "Security Risk", color: "red" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 325: Module with more workarounds than features → rewrite
  {
    terms: [
      { text: "Workarounds", color: "red" },
      { text: "Features", color: "blue" },
      { text: "Rewrite", color: "purple" },
    ],
    operators: [">", "→"],
    layout: "inline",
  },
  // Tip 326: Track how often debt items are deferred
  {
    terms: [
      { text: "Deferrals", color: "red" },
      { text: "3", color: "amber" },
      { text: "Not Priority", color: "red" },
    ],
    operators: [">", "="],
    layout: "inline",
  },
  // Tip 327: Strangler fig beats big-bang rewrites
  {
    terms: [
      { text: "Strangler Fig", color: "emerald" },
      { text: "Big Rewrite", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 328: Code untouched 2 years: perfect or abandoned?
  {
    terms: [
      { text: "2 Years Old", color: "amber" },
      { text: "Perfect", color: "emerald" },
      { text: "Abandoned", color: "red" },
    ],
    operators: [":", ":"],
    layout: "inline",
  },
  // Tip 329: Tech debt sprints don't work. Integrate into every sprint
  {
    terms: [
      { text: "Continuous", color: "emerald" },
      { text: "Debt Sprint", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 330: Healthy ratio: 70% features, 30% refactoring
  {
    terms: [
      { text: "Features", color: "blue" },
      { text: "Refactoring", color: "purple" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 331: Every debt item needs cost estimate
  {
    terms: [
      { text: "Debt Item", color: "red" },
      { text: "Cost", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 332: Abstractions requiring more code than what they abstract → remove
  {
    terms: [
      { text: "Abstraction", color: "purple" },
      { text: "Simplicity", color: "emerald" },
    ],
    operators: ["<"],
    layout: "inline",
  },
  // Tip 333: Monitor deprecated API usage
  {
    terms: [
      { text: "Deprecated Calls", color: "red" },
      { text: "Migration Debt", color: "amber" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 334: Reward unglamorous infrastructure improvements
  {
    terms: [
      { text: "Infra Work", color: "emerald" },
      { text: "Recognition", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 335: Tech debt retros quarterly with stakeholders
  {
    terms: [
      { text: "Debt Retro", color: "cyan" },
      { text: "Stakeholders", color: "amber" },
      { text: "Buy-In", color: "emerald" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 336: Track "temporary" solutions in production over 6 months
  {
    terms: [
      { text: "\"Temporary\"", color: "red" },
      { text: "6 Months", color: "amber" },
      { text: "Permanent", color: "red" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 337: Before refactoring, define success criteria
  {
    terms: [
      { text: "Success Criteria", color: "emerald" },
      { text: "Refactor", color: "purple" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 338: Cost of tech debt measured in frustration, not just hours
  {
    terms: [
      { text: "Frustration", color: "red" },
      { text: "Hours", color: "blue" },
      { text: "True Cost", color: "amber" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 339: If test suite needs refactoring, prioritize that
  {
    terms: [
      { text: "Test Health", color: "emerald" },
      { text: "Code Health", color: "blue" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 340: Track teams that reduce debt vs those that add it
  {
    terms: [
      { text: "Debt Reduced", color: "emerald" },
      { text: "Debt Added", color: "red" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 341: Track which open-source deps you rely on most. Sponsor them.
  {
    terms: [
      { text: "Key Deps", color: "blue" },
      { text: "Sponsorship", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 342: Contributing upstream fixes cheaper than maintaining patches
  {
    terms: [
      { text: "Upstream Fix", color: "emerald" },
      { text: "Internal Patch", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 343: Monitor team's open-source contributions
  {
    terms: [
      { text: "OSS Commits", color: "emerald" },
      { text: "Maturity", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 344: Critical dep with one maintainer = risk
  {
    terms: [
      { text: "1 Maintainer", color: "red" },
      { text: "Critical Dep", color: "purple" },
      { text: "Risk", color: "red" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 345: Open-source internal tools. External contributions improve quality.
  {
    terms: [
      { text: "Open Source", color: "emerald" },
      { text: "Quality", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 346: Track forks vs upstream contributions. Forks = debt.
  {
    terms: [
      { text: "Forks", color: "red" },
      { text: "Upstream", color: "emerald" },
    ],
    operators: [":"],
    layout: "inline",
  },
  // Tip 347: Inner-source across teams improves quality, reduces silos
  {
    terms: [
      { text: "Inner Source", color: "cyan" },
      { text: "Silos", color: "red" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 348: Best devs contribute to open source. Give dedicated time.
  {
    terms: [
      { text: "OSS Time", color: "emerald" },
      { text: "Growth", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 349: Track dependency license compliance automatically
  {
    terms: [
      { text: "Licenses", color: "amber" },
      { text: "Automation", color: "cyan" },
    ],
    operators: ["×"],
    layout: "inline",
  },
  // Tip 350: Before adopting dep, check maintenance pulse
  {
    terms: [
      { text: "Commits", color: "blue" },
      { text: "Issues", color: "red" },
      { text: "Pulse", color: "emerald" },
    ],
    operators: ["+", "="],
    layout: "inline",
  },
  // Tip 351: OSS contributions = hiring signal
  {
    terms: [
      { text: "Public Code", color: "emerald" },
      { text: "Hiring Signal", color: "amber" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 352: Heavy customization of OSS tool → contribute upstream
  {
    terms: [
      { text: "Custom Wrapper", color: "red" },
      { text: "Contribute Up", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 353: Track external visibility: blogs, talks, repos
  {
    terms: [
      { text: "Visibility", color: "emerald" },
      { text: "Hiring Edge", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 354: Inner-source docs should match OSS standards
  {
    terms: [
      { text: "Internal Docs", color: "cyan" },
      { text: "OSS Standards", color: "emerald" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 355: Internal package registry prevents reinventing utilities
  {
    terms: [
      { text: "Registry", color: "cyan" },
      { text: "Reinvention", color: "red" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 356: Track response time to security advisories in OSS deps
  {
    terms: [
      { text: "Advisory", color: "red" },
      { text: "Response Time", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 357: File issues on OSS, don't silently work around bugs
  {
    terms: [
      { text: "File Issues", color: "emerald" },
      { text: "Silent Workaround", color: "red" },
    ],
    operators: [">"],
    layout: "inline",
  },
  // Tip 358: OSS maintainer burnout. Rotate ownership.
  {
    terms: [
      { text: "Rotation", color: "cyan" },
      { text: "Burnout", color: "red" },
    ],
    operators: ["-"],
    layout: "inline",
  },
  // Tip 359: Track active vs abandoned dependencies
  {
    terms: [
      { text: "Active Deps", color: "emerald" },
      { text: "Abandoned", color: "red" },
    ],
    operators: ["/"],
    layout: "fraction",
    fractionSplit: 1,
  },
  // Tip 360: Critical dep not updated in a year → evaluate alternatives
  {
    terms: [
      { text: "Stale Dep", color: "red" },
      { text: "Alternatives", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 361: Community engagement = leading indicator of dep health
  {
    terms: [
      { text: "Community", color: "emerald" },
      { text: "Dep Health", color: "amber" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 362: Create approved dependencies list, review quarterly
  {
    terms: [
      { text: "Approved List", color: "cyan" },
      { text: "Quarterly Review", color: "amber" },
    ],
    operators: ["+"],
    layout: "inline",
  },
  // Tip 363: Contributing to tools you use builds unique expertise
  {
    terms: [
      { text: "Contribute", color: "emerald" },
      { text: "Expertise", color: "amber" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 364: Track internal tools that could benefit others → open source = free marketing
  {
    terms: [
      { text: "Open Source", color: "emerald" },
      { text: "Marketing", color: "amber" },
    ],
    operators: ["="],
    layout: "inline",
  },
  // Tip 365: Good docs for internal libs attract internal adopters
  {
    terms: [
      { text: "Docs", color: "cyan" },
      { text: "Adoption", color: "emerald" },
    ],
    operators: ["→"],
    layout: "inline",
  },
  // Tip 366: Healthiest cultures treat internal code like public open source
  {
    terms: [
      { text: "Internal Code", color: "blue" },
      { text: "OSS Standards", color: "emerald" },
      { text: "Culture", color: "amber" },
    ],
    operators: ["×", "="],
    layout: "inline",
  },
];

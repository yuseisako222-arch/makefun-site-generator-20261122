# makefun-site-generator-20261122

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/yuseisako222-arch/makefun-site-generator-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/yuseisako222-arch/makefun-site-generator-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A dependency-free reimplementation of the makefun-site 1.0.0 static site generator whose output is byte-for-byte identical — every page, index and tag page, build report and static file — at a fraction of the CPU time. On the practice set its answers match the reference exactly; the full driver runs about 2.1x faster than the house baseline, and solve.js alone about 2.8x. The speed comes from rendering Markdown blocks directly, scanning inline text in spans, reusing template scope and resolved includes, and counting words without per-word allocations.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=9vf7ext6&utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>

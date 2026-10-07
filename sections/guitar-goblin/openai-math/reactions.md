# Early public reaction to openai/math release (published 2026-10-06 21:47 UTC)

Search started: 2026-10-07 00:24 UTC (~2.6 h after publication). Absence of reaction at this stage is expected.

## (a) Concrete reported problems

Status as of 2026-10-07 ~00:56 UTC (~3.2 h after publication). Few concrete problems have been reported so far, and that is expected at this stage. No error has been reported that refutes any principal claim.

1. **Bloch's conjecture paper (item 3): a citation-level issue.** Daniel Litt (U. Toronto) wrote at 23:38Z: "Paper seems to cite some wrong existing work without mentioning it's wrong :-/ but AFAICT doesn't meaningfully rely on it." https://x.com/littmath/status/2107616410897678765. He did not say which paper is cited or which statement is wrong.
2. **Overlap/priority notes (not errors):**
   - Litt says family 027 ("Integral points on character varieties of curves") is "a (very special) case of a conjecture of mine, which is also a consequence of stronger work in progress by a student of mine". https://x.com/littmath/status/2107603741222289427
   - Héctor Pastén says the H10-over-Q paper (004) uses "the idea of getting quadratic growth in the height of rational points of a rank one elliptic curve that we introduce in this problem with Natalia and Xavier (ref [22]). I really need to see the details". https://x.com/hpasten/status/2107621871805980874
   - An anonymous junior researcher (@jackalblackhole) says he was scooped. He does not say which result.
3. **Framing and scope corrections (not errors):**
   - Litt (23:03Z): "Can anyone tell what the supposed 'substantial progress on a Millenium problem' was?"
   - Lichtman (23:42Z): "not the Millenium problem rumor."
   - Addington (23:44Z): Hodge is proved only "for Abelian varieties of CM type, and products of K3 surfaces… far from proving the whole thing."
   - AcerFur, who identifies as part of the OpenAI team (22:53Z): the 7/8 method "has a barrier at 3/4."
   - Lichtman (23:37Z): "The cubic family of L-functions appear to be essential for the proof, even for the corollary to the Riemann zeta function."
4. **Exposition complaints:**
   - HN user amluto says the UGC paper's notation (102, §1.1) is "pointlessly painful".
   - Shubhendu Trivedi says the 159 paper (quasipolynomial AP bounds) is "unreadable… just doing a more careful density increment?"
   - Eli Sennesh asks whether the Ising-perceptron paper is "just nonsense?"
   - Scott Kominers notes inconsistencies in how files are presented.
5. **Generic doubts with no specific error:**
   - Jeffrey Shallit: "not all of them will withstand scrutiny. There was already another LLM claim about Catalan that proved too hasty" (005).
   - HN users mathisfun123 and nautilus12: Lean statements may be mis-formalized.
   - Andrew Sutherland (MIT, quoted in SciAm): treat the single-agent claims as unverified, "We should ask for receipts".
6. **No public error-reporting channel.** GitHub Issues and Discussions are disabled on openai/math, so reports can only appear on social media or blogs.

## (b) Independent verification attempts (Lean / Comparator runs)

- **Family 073, Falconer distance conjecture in all dimensions: Comparator PASSED.** The run was done by Yongxi (Aaron) Lin, a math PhD student at CMU (GitHub CoolRmal).
  - Run: https://github.com/CoolRmal/falconer-all-dimensions/actions/runs/37545204340, started 23:12Z, success at 00:07Z.
  - Setup: unchanged upstream sources and challenge, real Landrun sandbox. The log reads "Lean default kernel accepts the solution / Your solution is okay!". The Nanoda kernel was not used.
- **Family 003, quasi-RH for ζ (Re s > 7/8): Comparator run IN PROGRESS**, also by Lin.
  - Run: https://github.com/CoolRmal/quasi-riemann-seven-eighths/actions/runs/37552488724, started 00:32Z, still in progress at 00:56Z. The Falconer run took about 55 min.
  - The target is the zeta theorem only. The Dirichlet-L statement is not checked in this run.
- No other independent Comparator, lake build, or lean4checker runs on openai/math were found on GitHub, X, Bluesky, HN, or Mathstodon. Lean Zulip and Reddit were not accessible.
- A structural review (no Comparator run) is in isaksmith/math REVIEW.md:
  - It finds no `sorry` in the Lean sources and about 811 challenge files.
  - It notes that 001, 002 and 004 have no Lean doc.
  - It notes that 20+ third-party Lean libraries are pinned, with local patches.
- A Comparator check confirms only the proof against the stated Lean target. Nobody has yet publicly audited whether the challenge statements are faithful.

## (c) General expert opinion (summary; details in log below)

Supportive or impressed:
- Alex Kontorovich (Rutgers) on quasi-RH: "instant Fields Medal"; "no Siegel zeros either. So I guess two Fields medals".
- Steven Strogatz (Cornell) on ω ≤ 9/4: "like Bob Beamon's long jump".
- Paata Ivanisvili (UC Irvine) on 4D Kakeya.
- Isaac Kim (UC Davis) on quantum and many-body results, including the Haldane gap and the 2D area law.
- Chris Peikert (U. Michigan) on UGC and L=RL.
- Ken Ono (UVA).
- Bartosz Naskręcki (Poznań).
- Jared Lichtman (Stanford): "absolutely historic".
- Joshua Zelinsky on the plane-coloring proof (158): the method is "not the direction the literature has previously gone in".
- Mahdi Ch. (TCS).
- Litt: "A lot of good stuff"; H10 over Q "pretty cool"; quasi-RH "quite important".

Measured or cautious:
- Nicolas Addington (Oregon).
- Álvaro Lozano-Robledo (UConn): wants experts to check "if there are actually really new ideas… or… clever use of old ideas".
- Thomas Bloom: "lots to do".
- Jordan Ellenberg and Jeremy Avigad (quoted by Quanta).

Critical or hostile, mostly about the process:
- Terence Tao (pre-release, 18:00Z): "harvested at large scale in an unsustainable fashion". He had posted nothing after the release as of ~00:30Z.
- Peter Woit's "Slopocalypse" post.
- David Roberts: "I won't be commenting".
- Robert McNees: "an attack on the math community".
- Heidi Goodson, Dan Garisto: "what a mess".
- Lior Pachter: sarcastic pre-release post.
- HN users on compute accounting and selection bias. For example, Jtarii: the 3-hour average will "ignore all the failed runs".

AGMAI (IAS) statement of Oct 6 (https://agmai.org/statement-oct6/):
- Explicitly not an endorsement of the results or the process.
- "the beginning, not the completion".
- Leaves it to the community to judge whether its recommendations were followed. SciAm reports that OpenAI did not publish prompts or per-result compute.

OpenAI staff: celebratory only (Altman, Weil, Sottiaux, roon). None of them addressed verification or errors. Insider AcerFur gave technical remarks: the 3/4 barrier, and that the method generalizes to Hecke L-functions.

## (d) Press coverage

- Scientific American (Joseph Howlett, Oct 6):
  - Quotes Sutherland (skeptical) and Litt (supportive).
  - The spokesperson said almost every result came from a single prompt to a single agent, but some needed multiple attempts.
  - https://www.scientificamerican.com/article/openai-unleashes-hundreds-more-math-results-upon-a-field-already-in-shock/
- Quanta "Transformation" blog (Konstantin Kakaes, Oct 6), "Deluge of 377 OpenAI proofs bewilders the math world":
  - Quotes Ellenberg, Avigad and Tao's Mastodon thread.
  - The WebFetch summary also gives these figures: about half formally verified in Lean, no errors found in the formal proofs, formalization exposed mistakes in existing literature, and a success rate of about 9% of roughly 4,000 problems. These came through an automated page summary, so check them against the article before quoting. They are not independent checks.
- NYT, "OpenAI Releases Findings on 377 Math Problems, Further Roiling Field": not accessible. It may have been published before the repo went public.
- The Verge (Robert Hart): not accessible.
- Others: Unite.AI, Interesting Engineering, RuntimeWire, FourWeekMBA, PANews, Techmeme cluster.
- Quanta and the NYT say "377", while the repo has 372 families. This discrepancy is unexplained.
- Pre-release context: Wired (Oct 6, "OpenAI Is Pissing Off a Bunch of Mathematicians–Again"); Economist, Guardian, Science, Atlantic and NYT coverage in September of the Navier–Stokes controversy and the Fields Medalists' declaration.

## Per-claim log

| Item | Reaction found (as of ~00:56Z) |
|---|---|
| 1. Quasi-RH 7/8 (003); 11/12 alt proof; Landau–Siegel | Kontorovich (rave); Lichtman (cubic L-family essential); Litt ("quite important"); AcerFur/insider (3/4 barrier); Mahdi Ch.; Comparator run in progress (zeta target only). Nothing on the 11/12 human-edited alt proof. Siegel zeros: only Kontorovich's "no Siegel zeros either". |
| 2. BSD Selmer corank ≤1 (002); Goldfeld | Lichtman only linked the paper; Nayebi lay remark. No expert assessment found. |
| 3. Hodge CM (032); Milne (001); Bloch | Hodge: Addington calibrates the scope. Milne: no reaction found. Bloch: **Litt reports citation of wrong prior work, likely not load-bearing.** |
| 4. UGC (102); L=RL=BPL (103); ω≤9/4 (107); int mult (109); Subset Sum 0.49 | UGC: Peikert, Mahdi Ch. (impressed); amluto exposition complaint; anon claim that a recent human UGC paper was "rushed out" to avoid AI scoop (unverified). L=RL: Peikert. ω≤9/4: Strogatz, dgacmu ("shocking… hope it holds up"). Int mult: HN amusement at κ=2^-182; one HN user asks for a machine-checked proof. Subset Sum: only lay exclamations. |
| 5. H10/Q (004); Catalan (005); π exponent (017); Artin (029) | H10: Litt "pretty cool"; Pastén says it builds on his group's idea and wants details. Catalan/π: Shallit relays the claims and is skeptical (earlier hasty LLM Catalan claim). Artin "every admissible base": no reaction found. |
| 6. Free group factors (287); Kadison (288); Baum–Connes/K–K (285); Kaplansky (196/197) | No expert reaction found (only lay lists and LLM explainers). |
| 7. Mahler (087); Erdős reciprocal/Erdős–Turán (159); Hadwiger–Nelson (158); Borsuk dim 9 (156); Sidorenko (161) | 158: Zelinsky (novel method), Gostev (AI practitioner). 159: Mahdi Ch. (impressed), Trivedi (unreadable, density increment?), Zelinsky. Mahler, Borsuk, Sidorenko: no reaction found. |
| 8. Hilbert 16th (143); Thompson F (248); Cannon (246); Hilbert–Smith (304); Zariski (047) | Hilbert–Smith: Trivedi lists it as of interest. Otherwise no reaction found. |
| 9. Heisenberg magnetization (271); BEC (267); Haldane (268); Anderson (261); Vlasov–Maxwell (362); Mézard–Parisi (221) | Isaac Kim lists the Haldane gap and 2D area law among "shocking" results. Otherwise no reaction found. |
| 10. Restriction (077); Falconer (073); Kakeya 3D/4D (074) | **Falconer: independent Comparator PASS (Lin, CMU).** Kakeya 4D: Ivanisvili, Lichtman (impressed). Restriction: no reaction found. |
| Meta | Selection (~4,000 posed, ~9% per Quanta), the 3h compute claim, and missing prompts are all criticized. Lean statement fidelity is raised as a worry on HN, but nobody has audited it yet. AGMAI does not endorse. Earlier episodes (Navier–Stokes, the Aug "ten proofs" with the Sienicki human audit arXiv:2608.14673, and the Oct 2025 Erdős "solved" retraction, https://techcrunch.com/2025/10/19/openais-embarrassing-math/) are invoked as context. |

## Methods and limitations
- X was read through the public api.fxtwitter.com mirror (profile timelines of about 60 named accounts, plus keyword search). Bluesky was read through the public AppView searchPosts/getPostThread API, Mathstodon through the public Mastodon API, and HN through Algolia. GitHub was read through the unauthenticated REST API (forks, repo search, Actions runs). Blogs were read through RSS, and AGMAI and press sites through WebFetch.
- Blocked or unavailable: Reddit (403), NYT, The Verge and the OpenAI blog (fetch refused), Lean Zulip (login required; public archive stale), and some X handles (proxy 403, or the handle does not exist).
- Credentials marked "from general knowledge" were not re-verified during this session.

## Detailed source log (chronological by source)

### GitHub (checked 2026-10-07 00:25 UTC)
- openai/math: created 2026-10-06T21:47:02Z, last push 22:01:11Z (single "Initial commit" adc7f124, author "Anonymous"). **Issues and Discussions are DISABLED** (has_issues=false, has_discussions=false) -> no public issue tracker for error reports. ~1,527 stars, 125 forks at 00:25 UTC.
- Forks with new commits (5): none contain a Comparator run or expert error report.
  - isaksmith/math (Isak Smith, credentials unknown) commit ba42cbac 2026-10-06T23:43Z: exploration/REVIEW.md — a neutral structural review: counts 235/372 families with Lean doc; "no `sorry` found" in ~122k Lean files; ~811 Comparator challenge files; notes headline 001 (Milne), 002 (BSD), 004 (H10 over Q) have NO Lean doc while 003 (quasi-RH 7/8) does; 003's Lean doc "has no explicit constant and leaves out the paper's later applications"; trusted base pins 20+ third-party Lean libraries (PrimeNumberTheoremAnd, StrongPNT, carleson, ClassFieldTheory, sphere-eversion, gromov, TauCeti, an `iut` repo...) with local patches under lean/patches/; Comparator needs `landrun` (Linux Landlock). Did NOT report running Comparator. Sentiment: neutral/cautious. URL: https://github.com/isaksmith/math/blob/738ed9e5/exploration/REVIEW.md
  - snakewizardd/math (anonymous; analysis produced with GitHub Copilot agent) 2026-10-06T22:58–23:27Z: notes/filtered-products-visual/ANALYSIS.md — read-through of "Filtered products and boundary-preserving compression in complex cobordism" (companion to "Radius of comparison equals half the mean dimension"); numerically checks a simplex-slicing lemma (5,400 points) — "all claims hold on the sample"; mentions "corrections to the first sim" (its own simulation, not the paper). Sentiment: supportive, non-expert, AI-assisted. Low weight.
- Press links surfaced via isaksmith REVIEW.md: OpenAI blog "Sharing AI progress in mathematics" (https://openai.com/index/sharing-ai-progress-in-mathematics/), companion PDF https://cdn.openai.com/pdf/reasoning-walkthroughs.pdf, Scientific American "OpenAI unleashes hundreds more math results upon a field already in shock", Unite.AI, OpenAI community forum thread 1403886. Also states (citing SciAm) that a spokesperson said almost every result came from a single prompt to a single agent; exceptions = zeta zero-free region work and Hodge for CM abelian varieties; release practices shaped by "IAS Advisory Group on Mathematics and AI"; no prompts published.

### Hacker News (checked 2026-10-07 00:25 UTC)
Stories: 49984923 "Sharing AI progress in mathematics" (openai.com) 22:17Z, 282 pts/243 comments; 49984976 repo link 22:22Z; 49985524 "Integer multiplication below n log n" 23:14Z (9 comments); 49985397 "The Quasi-Riemann Hypothesis [pdf]" 23:00Z; 49985740 "OpenAI just dropped 700 preprints" 23:37Z.
Pre-release context stories (same search): Wired 2026-10-06 17:45Z "OpenAI Is Pissing Off a Bunch of Mathematicians–Again"; 2026-10-06 18:46Z tweet "UT Austin Math Chair says OpenAI preparing to release 400 AI-generated proofs"; OpenAI "Advisory Group on Mathematics and AI" 2026-09-21; Economist 2026-09-11 "Top mathematicians are outraged by OpenAI's methods"; NYT 2026-09-10 Tristan Buckmaster / Navier–Stokes $1M proof clash; Science 2026-09-16 "existential crisis"; Atlantic "Math Can't Go on Like This"; Guardian 2026-09-12; Quartz: "2nd mathematician (Andreas Thom) accusing OpenAI of being dishonest about training data"; Boston Review reading list; Xena blog 2026-10-01 "To grieve, or not to grieve?" (HN 49919676).
Main-thread content (all pseudonymous, no verified experts; no concrete error reported as of 00:25Z):
- mathisfun123 (22:46Z, id 49985243): skeptical — "With so many results in so many different areas no way they even remotely spot checked well enough. Prediction: one of these is wrong… For lean to function as a proof certificate you need to represent the theorem correctly." 
- nautilus12 (23:21Z): "The ones with lean proofs could still be formulated incorrectly." tootie (23:37Z, 00:14Z): "Note that these are all preprints. None are verified."
- amluto (23:46Z, id 49985822): criticizes notation/exposition in UGC paper (family 102) §1.1 as "pointlessly painful… extremely easy to make mistakes" — exposition complaint, not a mathematical error.
- NotOscarWilde (self-described TCS/scheduling person, 23:24Z, id 49985622): flags "A Polynomial-Time Algorithm for Three-Machine Unit-Job Scheduling" (open since Garey–Johnson 1979) — "I have no capacity to check its correctness today"; notes a huge exponent and an old computational model.
- prideout (22:54Z): notes a proof of Barnette's conjecture; "looks approachable at first glance".
- zone411 (23:16Z): claims list covers ~90 of proofatlas.ai top-500 open problems (H10 over Q, UGC, Anderson extended states, spacetime Penrose, Landau–Siegel zeros, Baum–Connes, Abundance, Hadwiger, BEC, 2D area law).
- dgacmu (23:39Z): "I find the claimed matrix multiply result (w<= 2.25) shocking. I hope it holds up."
- Integer-mult thread: amusement at κ = 2^(−182) exponent ("n (log n)^(1−κ)"); Chinjut: "Many suspected it was not possible"; sobellian expects a galactic algorithm. No error reported.
- Compute skepticism: orlp, Jtarii ("That estimate is obviously going to conveniently ignore all the failed runs") re "three hours of ChatGPT Pro thinking".
- aaraujo002/tchalla quote Advisory Group (agmai.org/general-sep29/): "we do not endorse this practice, and we ask them to stop testing advanced mathematical problems on proprietary models."
- schleck8 (00:19Z) relays Levent Alpöge (identified as Anthropic mathematician) quote: "…blurring our eyes a bit to combine the past ten years, with today a measurement of those developments, there is nothing comparable." (original source not yet located)
- xanderlewis (23:36Z) quotes Kevin Buzzard: "Six years later we are beginning to understand the answer to this question." (source/timing not yet confirmed — may predate release)
- warkdarrior links Tao Mathstodon post https://mathstodon.xyz/@tao/117395269325940185 (to check timing).

### Mathstodon (checked 2026-10-07 ~00:30 UTC)
- Terence Tao (UCLA, Fields Medal), @tao — NO post after the 21:47Z release as of ~00:30Z (account last_status_at = 2026-10-06; latest posts are pre-release). Pre-release, same day:
  - 2026-10-06 13:51Z https://mathstodon.xyz/@tao/117394287977270632 — shares parody of "rumored upcoming press release by OpenAI": "OpenAI Releases the Final Ten Minutes of 500 Previously Unreleased Films…". Sentiment: skeptical/satirical (about the anticipated release, not its contents).
  - 2026-10-06 18:00Z 4-part thread https://mathstodon.xyz/@tao/117395267721642920 … /117395269325940185 — "Math 1.0 vs Math 2.0": "solutions to open problems are now being harvested at large scale in an unsustainable fashion, leaving entire fields of mathematics much less fertile"; AI prompters "do not understand the AI output well enough to answer questions on the result". Sentiment: critical of mass AI problem-solving (meta), no claim-specific comment.
  - Earlier: 2026-09-11 joint declaration of 25 Fields Medalists incl. Tao, https://mathandai.org/ (Economist coverage).
- Tag timelines (#openai, #mathematics, #lean on mathstodon federated view): only HN-bot reposts and a Verge-feed repost; no expert discussion of specific results found.

### Press (first pass)
- Scientific American, Joseph Howlett, 2026-10-06, "OpenAI unleashes hundreds more math results upon a field already in shock" https://www.scientificamerican.com/article/openai-unleashes-hundreds-more-math-results-upon-a-field-already-in-shock/ (via WebFetch summary; quotes as returned):
  - Andrew Sutherland (MIT): "Until and unless they release the model and people can replicate their results, I think you should treat any claims about one-shotting problems with a single agent as unverified. We should ask for receipts." — skeptical (process/compute claims).
  - Daniel Litt (U. Toronto): "If we want to know the answers to these math questions, I see no reason why we should ask the company to keep them secret from us. To me, it's going to be a good thing for mathematics." — supportive of release.
  - Reports Tao has criticized the "insane" pace; OpenAI spokesperson acknowledged some results needed multiple attempts; only average compute published, no prompts; OpenAI did not comply with the advisory group's Sept 29 call to publish model/prompts/per-result compute. Article mentions 4D Kakeya (family 074) and RH progress as headline claims.
- The Verge, 2026-10-06 ~23:26Z, "OpenAI drops another batch of mathematical breakthroughs" https://www.theverge.com/ai-artificial-intelligence/1005004/openai-math-release-github (could not fetch; feed snippet: "extends a run of breakthroughs that have both impressed and unsettled parts of the mathematical community while raising questions about research ethics").
- Also: Unite.AI, Interesting Engineering ("OpenAI's largest math release tackles 4,000 problems with Lean proofs"), FourWeekMBA, PANews, runtimewire, alphasignal, ua.news. Interesting Engineering/Unite summaries: OpenAI says "verification varies across the papers and that citations and exposition need further work"; consulted IAS Advisory Group on Mathematics and AI.

### X/Twitter (via api.fxtwitter.com public mirror; checked ~00:35–00:45 UTC)
- OpenAI announcement tweet: https://x.com/OpenAI/status/2107596713791767021 (2026-10-06 ~22:20Z): "We're releasing a broad range of new mathematical results produced by an internal frontier model. We've been consulting with the independent Advisory Group on Mathematics and Artificial Intelligence at the Institute for Advanced Study…"
- OpenAI community forum post by staff "sps", 2026-10-06 ~22:47Z: https://community.openai.com/t/first-look-at-mathematics-manuscripts-from-an-internal-frontier-model-at-openai/1403886 — announcement only, no replies with errors.
- **Daniel Litt** (Asst. Prof. of Mathematics, U. Toronto; visiting Harvard Fall 2026; algebraic geometry/number theory), thread starting https://x.com/littmath/status/2107603741222289427 (2026-10-06 22:47Z):
  - 22:47Z: "Fun! Looks like mathematicians have a lot of exciting work to do. If I understand correctly one of the results is a (very special) case of a conjecture of mine, which is also a consequence of stronger work in progress by a student of mine." (00:16Z he identifies it as family **027**, "Integral points on character varieties of curves".) Sentiment: supportive; notes partial overlap with a student's stronger work in progress.
  - 22:51Z https://x.com/littmath/status/2107604750740979933: "A lot of good stuff in there!"
  - 22:53Z https://x.com/littmath/status/2107605311792328810: "LOL 2 counterexamples to the Shafarevich conjecture. They're double-dipping!" (light-hearted remark about counting).
  - 23:03Z https://x.com/littmath/status/2107607603035398410: "Can anyone tell what the supposed 'substantial progress on a Millenium problem' was? There's some cool stuff in there but so far have no idea what that was referring to." Sentiment: skeptical of framing/marketing.
  - 23:21Z: "Section conjecture over Q_p is pretty interesting to me!"
  - 23:27Z https://x.com/littmath/status/2107613805970649306: "Hilbert's 10th for \mathbb{Q} is pretty cool!" (family **004**) — supportive, no verification claimed.
  - 23:38Z https://x.com/littmath/status/2107616410897678765: "**Proof of Bloch's conjecture! I thought about that a bit in grad school. Paper seems to cite some wrong existing work without mentioning it's wrong :-/ but AFAICT doesn't meaningfully rely on it.**" — REPORTS A CONCRETE (minor, citation-level) PROBLEM in the Bloch's conjecture paper (item 3).
  - 00:18Z (Oct 7) https://x.com/littmath/status/2107626576674513215, asked about quasi-RH: "No, it's quite important and interesting, just not to my taste."
  - 23:19Z to a junior researcher who said he got scooped: "my expectation is that this will happen to everyone soon enough and so not impact the job market..."
- **Héctor Pastén** (@hpasten; number theorist, works on Hilbert's 10th problem/Büchi; affiliation believed PUC Chile — not verified here), reply to Litt's H10 tweet, 2026-10-06 23:59Z https://x.com/hpasten/status/2107621871805980874: "They seem to use the idea of getting quadratic growth in the height of rational points of a rank one elliptic curve that we introduce in this problem with Natalia and Xavier (ref [22]). I really need to see the details of this!" (Natalia = Garcia-Fritz, Xavier = Vidaux, presumably.) Sentiment: interested/reserving judgment; notes the H10-over-Q paper (family 004) builds on his group's idea.
- Benjamin Antieau (@benantieau; Northwestern mathematician, K-theory — affiliation from general knowledge) 23:44Z reply on Bloch: "I also thought a bit about this one in grad school." Neutral.
- @jackalblackhole (anonymous junior researcher) 23:03–00:01Z: says he was scooped by the release; "getting scooped by slop that no one at openai even understands the abstracts of"; tempted to post his own work and not credit OAI. Sentiment: hostile.
- @Jinnanog5 (OR person) 00:09Z: on family 124 (3-machine unit-job precedence scheduling, Garey–Johnson): "if it holds… Feels like the bottleneck is shifting to people reading formal statements rather than proofs."
- Pre-release context: @AGTPinsights summary that **Francesco Maggi** (UT Austin math chair) questioned the then-rumored "400-proof release", saying experts are still working out the Navier–Stokes example (https://x.com/AGTPinsights/status/2107244362099007745).
- **Alex Kontorovich** (Rutgers; analytic number theory; Lean/PrimeNumberTheoremAnd project lead — credentials from general knowledge), https://x.com/AlexKontorovich/status/2107609087902941646 2026-10-06 23:08Z (≈56k views): "Quasi-RH?!?!???! Are you kidding me? If a human did this, it would be an instant Fields Medal, no questions asked. RH says zeta has no zeros in Re(s)>1/2. The best we had until a second ago was a region that got thinner and thinner… They got a zero free strip!!!! Insane". Follow-up 00:22Z https://x.com/AlexKontorovich/status/2107627562721833292: "Yeah, no Siegel zeros either. So I guess two Fields medals…" Sentiment: strongly supportive/impressed (family 003 + Landau–Siegel); no statement that he checked the proof or ran Comparator.
  - Reply, **Álvaro Lozano-Robledo** (UConn number theorist; @mathandcobb) 23:50Z https://x.com/mathandcobb/status/2107619625437442152: "Really looking forward to people like you looking into this proof to see if there are actually really new ideas in there or somehow a very clever use of old ideas!" — cautious/neutral.
  - Reply, Scott Kominers (Harvard Business School economist) 00:28Z https://x.com/skominers/status/2107628769158828164: fascinated by "micro-inconsistencies in the way the papers are presented" (most files "paper.pdf", one has a .gitignore) — presentation remark, not math error.
  - Reply, Vlad Balin (unknown) 00:26Z: "these proofs are not considered valid until they have been verified by humans."
- **Thomas Bloom** (Oxford/Manchester; runs erdosproblems.com — credentials from general knowledge) 23:18Z https://x.com/thomasfbloom/status/2107611500626198533: "All mathematicians should take a brief holiday to recover… Then we'll get back to work; lots to do." Neutral/wry.
- OpenAI-affiliated: Sam Altman 00:06Z https://x.com/sama/status/2107623610483720463 "We are entering a new era of discovery now"; Kevin Weil (OpenAI) 23:47Z https://x.com/kevinweil/status/2107618767144710399 "What an incredible release today from OpenAI"; Boaz Barak, Sébastien Bubeck, Noam Brown only reposted OpenAI's announcement (as of ~00:40Z). Will DePue (OpenAI) posted an LLM-generated ranking claiming "81% of [top discoveries of last three years] have been released today".
- Checked, no post-release posts found (as of ~00:40Z): Tim Gowers (@wtgowers, last 10-04), Ryan O'Donnell (@BooleanAnalysis, last 10-06 16:24Z), Lance Fortnow (@fortnow, last 10-06 10:46Z), Gil Kalai (@GilKalai, last 10-04), Emily Riehl (last 09-28), Jordan Ellenberg (last 10-05), Mark Sellke (last 09-17). Gary Marcus posted only about an unrelated podcast. @XenaProject (Buzzard) could not be fetched.
- **Paata Ivanisvili** (UC Irvine, harmonic analysis — from general knowledge), 2026-10-06 22:49Z https://x.com/PI010101/status/2107604089265688691: "Kakeya in 3D won a Fields Medal. Kakeya in 4D was solved by AI. Let that sink in." (family 074) Sentiment: impressed; no verification claimed.
- **Ken Ono** (UVA number theorist), 23:23Z https://x.com/KenOno691/status/2107612779264000261: "OpenAI's release today makes clear that AI-assisted mathematical discovery at the highest level is no longer hypothetical." (quoting Bartosz Naskręcki @nasqret: "nobody expected the era of 'superhuman mathematicians' to arrive in 2026. And it's a big mess.") Supportive.
- Aran Nayebi (CMU, ML/neuroscience) 22:40Z https://x.com/aran_nayebi/status/2107601826812227705: "yes *this* updates my timelines" citing Hodge for CM (032), BSD for density-one set (002 & 006), H10 over Q (004).
- Other X results for UGC/quasi-RH/H10/Catalan/π/BSD/Hodge keyword searches: overwhelmingly lay/hype accounts, LLM-generated summaries (e.g., "Opus 5.5 on github.com/openai/math"), and lists; no expert error reports.

### Bluesky (public AppView search API; checked ~00:42Z)
- **Nicolas Addington** (U. Oregon, algebraic geometry — from general knowledge), https://bsky.app/profile/naddington.bsky.social/post/3mxalenc5ac2w 23:26–23:44Z: "If you're wondering about the Hodge conjecture, they prove it for Abelian varieties of CM type, and products of K3 surfaces. Which is a big deal, but far from proving the whole thing or giving a counterexample as had been suggested." On family #054 (cubic fourfolds: very general member of Hassett divisor C_d irrational for d>>0; cites his papers): "I haven't digested the proof yet of course -- it involves quantum cohomology but seems more down-to-earth than the famous paper of Yu et al." Sentiment: measured, calibrating scope.
- **Nathaniel Johnston** (Mount Allison U., quantum information), https://bsky.app/profile/njohnston.ca/post/3mxakncsa5k2x 23:13Z: notes a paper disproving the PPT-squared conjecture ("Entanglement with zero distillable secret key in local dimension ten"); "I am exactly 0% surprised that this conjecture is false… But people have worked *hard* to prove and to disprove it." Supportive/neutral.
- **Jeffrey Shallit** (Waterloo), 23:07Z https://bsky.app/profile/shallit.bsky.social/post/3mxakb7f63s2v: "OpenAI is announcing the irrationality measure of pi is 2 & Catalan's constant is irrational, among many other results." Neutral relay (families 017, 005).
- **Heidi Goodson** (Brooklyn College number theorist), 00:29Z: "Currently stunned and don't know what to say"; then "I guess by posting this I'm giving them free advertising 💩". Negative/ambivalent.
- Shubhendu Trivedi (ML researcher), 23:45Z–00:03Z on family 159 "Quasipolynomial Bounds for Arithmetic Progressions": "definitely impressive… But unfortunately, this is unreadable… my surprise is that it seems to be just doing a more careful density increment?"; "inequality 2.4 is key, but I don't understand the theorem statement." Skeptical on readability; no error claimed.
- Eli Sennesh (comp. neuroscience postdoc), 00:09Z, on "The free energy of the Ising random perceptron": "Are we sure this isn't just nonsense? I should be able to understand this one but it's, uh, pretty difficult." Doubt, no specific error.
- Robert McNees (Loyola Chicago physicist), 23:04Z: "This isn't the work of a group trying to 'improve how we share results with the math community.' It's an attack on the math community." Hostile (meta).
- Dan Garisto (science journalist) 23:46Z: "Dropping 722 papers of AI solved proofs all at once... what a mess." Benjamin Friedman 23:37Z: BibTeX author is just "OpenAI" — "jarring cultural disconnect". Timothy Raben 22:59Z: "Let's wait and see how many were already in their training data".
- Press via Bluesky: **NYT** "OpenAI Releases Findings on 377 Math Problems, Further Roiling Field" (NYT bot record timestamp 2026-10-06 20:55Z — i.e., possibly before repo went public at 21:47Z; not verified); **Quanta** "Transformation" blog post "Deluge of 377 OpenAI proofs bewilders the math world" (00:35Z Oct 7); Techmeme summary of SciAm: "nearly all from a single prompt handed to a single AI agent; some might have taken multiple attempts". Note "377" in NYT/Quanta vs 372 families in repo (discrepancy unexplained).
- **Joshua Zelinsky** (mathematician, Hopkins School; active in Erdős-problems community), Bluesky 2026-10-06 23:03Z https://bsky.app/profile/joshuazelinsky.bsky.social/post/3mxak2ehihc24: "Even at a glance, this is boggling…"; on family 158 (plane not 5-colorable): "I've only had time to start looking at the chromatic plane proof, and it doesn't look like the method is a direction that the prior lit used to my knowledge. This is far beyond merely building on existing methods or seeing connections between different problems." Supportive/impressed; preliminary.
- @awfullyvague (anon) 00:08Z: "Recent progress was made on Unique Games Conjecture (which was rushed out, according to the authors, to avoid being scooped by AI)." (unverified; no link; possibly refers to a recent human paper — worth checking for priority/overlap).
- **David Roberts** (@highergeometer, U. Adelaide), Mathstodon 23:49Z https://mathstodon.xyz/@highergeometer/117396639775257026: "I won't be commenting on the dump of hundreds of maths papers from an AI lab." (deliberate abstention; negative tone)
- **Steven Strogatz** (Cornell), X 22:56Z https://x.com/stevenstrogatz/status/2107606017706266686 (≈45k views): "Many staggering results here. But this is a particularly amazing one: the exponent for matrix multiplication is no more than 2.25. The previous world record had been something like 2.37. This leap in progress is like Bob Beamon's long jump." (family 107) Supportive; no verification.
- **Isaac Kim** (UC Davis, quantum information), X 23:02Z https://x.com/Isaac__kim/status/2107607429437657563: "shocking list of problems in quantum information, many-body physics and quantum computing… 1. Proof of area law in 2D. 2. Spin-one Haldane gap [family 268] 3. Parity is not in QAC^0 4. Constant-error Aaronson-Kuperberg conjecture 5. Unitary VOAs generating conformal nets." Supportive; no verification.
- **Bartosz Naskręcki** (Adam Mickiewicz U., Poznań), X 22:47Z https://x.com/nasqret/status/2107603686113628627: "I am browsing these results in awe. It's only going to get faster from here."
- Peter Gostev (AI practitioner, not mathematician), X 22:46Z https://x.com/petergostev/status/2107603534308864146: spent "300 billion tokens on Hadwiger–Nelson… and here it is, five-colours is no go". Later 23:45Z joke about OpenAI "steal[ing]" students' homework to solve "377 open maths problems".
- Techmeme cluster https://www.techmeme.com/261006/p46 lists press: The Verge (Robert Hart), NYT ("OpenAI Releases Findings on 377 Math Problems, Further Roiling Field"), RuntimeWire, Unite.AI, Scientific American.

### INDEPENDENT COMPARATOR RUNS FOUND (GitHub search, ~00:45 UTC)
- **Yongxi (Aaron) Lin** (GitHub CoolRmal; bio: "PhD student in math at Carnegie Mellon University… formal verification of math"):
  - **Family 073 Falconer distance conjecture, all dimensions — Comparator PASSED.** Repo https://github.com/CoolRmal/falconer-all-dimensions (created 2026-10-06 23:09Z) extracts the unchanged Lean sources + upstream Comparator challenge (FalconerAllDimensions.json) at upstream commit adc7f124. GitHub Actions run https://github.com/CoolRmal/falconer-all-dimensions/actions/runs/37545204340 (started 23:12Z, completed 2026-10-07 00:07Z, conclusion success; an earlier run 37545064104 failed at 23:11Z on setup/package-name issue, fixed in commit a90f416f). Log: "Lean default kernel accepts the solution / Your solution is okay! / Finished with result: success"; 11,307 build jobs; real Landrun sandbox; allowed axioms propext, Quot.sound, Classical.choice; Nanoda kernel not enabled. Target theorem `OAI.Falconer.falconer_distance_conjecture`: for d ≥ 2 and compact E ⊂ R^d, dim_H E > d/2 ⇒ distance set has positive Lebesgue measure. (This checks proof-vs-stated-target; it does not by itself establish that the challenge statement faithfully encodes the paper/conjecture.)
  - **Family 003 quasi-RH (ζ(s) ≠ 0 for Re s > 7/8) — Comparator run IN PROGRESS** (repo https://github.com/CoolRmal/quasi-riemann-seven-eighths, created 00:28Z; run https://github.com/CoolRmal/quasi-riemann-seven-eighths/actions/runs/37552488724 started 00:32Z, status still in_progress at 00:53Z). README: "Comparator verification is pending." Target: `OAI.riemannZeta_ne_zero_of_seven_eighths_lt_re` (zeta only; the Dirichlet-L theorem in the same module is NOT a target of this run). Depends on PrimeNumberTheoremAnd + Rellich with upstream compatibility patches.

### More X (TCS etc., ~00:48 UTC)
- **Chris Peikert** (U. Michigan, lattice cryptography), 23:43Z https://x.com/ChrisPeikert/status/2107617657415782731: "What can even be said… Unique Games Conjecture, proved. L=RL, proved. And that's just the first two CS results…" Impressed; no verification.
- **@mahdi_tcs_** ("Mahdi Ch.", TCS researcher; believed to be Mahdi Cheraghchi, U. Michigan — not confirmed): 23:14Z on quasi-RH "This already would give genuine improvements on prime counting error"; 00:17Z UGC paper "shorter than a typical FOCS/STOC paper"; 00:13Z family on edit distance embedding into L1 ("Ostrovsky-Rabani's… (essentially) optimal?!"); 00:02Z "Explicit Ramanujan graphs for all degrees??"; 23:58Z on 159 "Erdős reciprocal sum???"; 23:43Z "we have years of work ahead of us to human-understand all these breakthroughs". Impressed; no verification.
- Lior Pachter (Caltech) pre-release 20:24Z https://x.com/lpachter/status/2107567762495439202: "Mathematician waiting for the 400 solutions that they were told @OpenAI would release a few hours ago." (sarcastic; no post-release comment found as of ~00:48Z).
- OpenAI staff: Tibo Sottiaux 22:24Z "our models did solve some important math problems… Remarkable new era of scientific progress"; roon (@tszzl) "we are breathing rarefied air"; Mark Chen, Greg Brockman, Jerry Tworek: no post-release posts found; Alexander Wei, Aidan McLaughlin, Boris Power, Bubeck, Noam Brown, Boaz Barak: reposts only. No OpenAI staff statement addressing errors/verification found beyond README/blog.

### Advisory Group on Mathematics and AI (AGMAI, IAS) statement — 2026-10-06
- https://agmai.org/statement-oct6/ (members: François Charles, Camillo De Lellis, Timothy Gowers, Martin Hairer, Nikhil Srivastava, Ulrike Tillmann, Ravi Vakil, Edward Witten, Melanie Matchett Wood). Key text: "AGMAI's advisory role should not be interpreted as a judgment of the impact of these results or an endorsement of the process by which OpenAI obtained them… only the mathematical community can undertake the assessment that is needed. Making this work public is a first step. This release is the beginning, not the completion, of the process of human understanding… the future of mathematical research cannot consist only of understanding results produced by AI labs… Equitable access to powerful research tools and adequate computational resources are essential… it is ultimately up to the mathematical community to assess the extent to which our recommendations were followed successfully." Sentiment: explicitly non-endorsing, neutral-to-cautious; no claim-specific assessment.
- Earlier (2026-09-29) general recommendations https://agmai.org/general-sep29/: "we do not endorse this practice, and we ask them to stop testing advanced mathematical problems on proprietary models"; asked for model, exact prompts, per-result compute (per SciAm, OpenAI did not publish prompts/per-result compute).
- Related context: Ben Antieau guest post on Tao's blog, 2026-10-06 21:50Z (3 min after repo creation), announcing "Hexagon", a community repository for LLM-generated results that "welcomes submissions by large labs" https://terrytao.wordpress.com/2026/10/06/hexagon/ — no comments yet; not a reaction to specific claims. (openai/math README says OpenAI is "exploring community-hosted repositories".)
- Peter Woit (Columbia), "Not Even Wrong", post "Slopocalypse", 2026-10-06 22:40Z https://www.math.columbia.edu/~woit/wordpress/?p=15896: notes OpenAI says it drew on AGMAI advice "although one of the recommendations at the top was 'we ask them to stop testing advanced mathematical problems on proprietary models.' Like everyone else, I'll spend some of this evening sorting through the long list to see what is of interest." Skeptical framing (title), no claim-specific content; 0 comments in feed at ~00:50Z.
- Blogs checked with NO post-release post (as of ~00:50Z): Shtetl-Optimized (Aaronson; last post 10-04), Computational Complexity (Fortnow/Gasarch; last 10-04), Gil Kalai (last 10-04), Xena/Buzzard (last 10-01 "To grieve, or not to grieve?"), Gowers's Weblog (last 09-17 "Why I didn't sign the Fields medallists' letter"), Igor Pak (last 09-25), Silicon Reckoner/Michael Harris (last 09-30), Windows on Theory/Boaz Barak (last 09-23), Gödel's Lost Letter (stale), Tao's blog (only Hexagon guest post + pre-release posts).
- Not reachable: Reddit (403 blocked for r/math, r/MachineLearning etc.), Lean Zulip (API requires login; public archive stale since Feb 2026), MathOverflow (not yet checked), NYT (blocked), The Verge (blocked), OpenAI blog (403).

### Number theory specialists on X (~00:52 UTC)
- **Jared Duker Lichtman** (Stanford, analytic number theory — from general knowledge), https://x.com/jdlichtman:
  - 23:09Z https://x.com/jdlichtman/status/2107609204722892924: "OpenAI has just released floodgates for 300+ solutions… a zero-free strip for the Riemann Zeta function… Hodge conjecture for CM abelian varieties".
  - 23:37Z https://x.com/jdlichtman/status/2107616346850927090: "**While reading their proof, important note: The cubic family of L-functions appear to be essential for the proof, even for the corollary to the Riemann zeta function**" (structural observation about family 003, not an error claim).
  - 23:42Z https://x.com/jdlichtman/status/2107617476712575153: "This output is absolutely historic by any objective metric. However, it is not the Millenium problem rumor that was buzzing around in past weeks. Worth bearing in mind..."
  - 00:35Z on 4D Kakeya (074), 00:37Z flags "Exact Birch-Swinnerton-Dyer Formula from Low Selmer Corank" (002) as "related work on BSD"; 00:44Z "Inverse Goldbach is such a beautiful problem". Supportive; reading, no verification claimed.
- **@AcerFur ("Acer"; ~10k followers; amateur mathematician known from Erdős-problems work — identity not confirmed here) — self-identifies as part of the OpenAI team**: 22:24Z https://x.com/AcerFur/status/2107598008036806912 "It was a huge honour to have been part of this team. A uniform zero-free strip."; 22:31Z "(fwiw the proof should generalise to all unitary Hecke L-functions over any number field)"; 22:53Z https://x.com/AcerFur/status/2107605089225691372 "Polymath project bringing down 7/8 towards 1/2 when? (**FWIW the method has a barrier at 3/4**, so it needs a nice new idea)"; 22:59Z on integer multiplication below n log n: "I was definitely very surprised when this one came in". (Insider statements, not independent.)
- Emad Mostaque 22:56Z "got 722 problems but the hodge conjecture ain't one" / "*special case excepted" (calibration of Hodge claim; not an expert).
- Reply to Lichtman by @thebasedcapital (00:44Z) claims "openai attached a lean artifact to exactly one of them" — **this is factually wrong** per repo (≈160 papers formalized); noted only as misinformation in circulation.

### MathOverflow / Math.SE
- StackExchange API (checked ~00:52Z): no MathOverflow or Math.SE questions mentioning OpenAI since the release.
- **Jeffrey Shallit** (U. Waterloo, combinatorics on words/number theory), Bluesky 23:19Z https://bsky.app/profile/shallit.bsky.social/post/3mxakwssnps2m: "I think we have to wait and see. With so many claims it seems likely not all of them will withstand scrutiny. **There was already another LLM claim about Catalan that proved too hasty.**" Skeptical (family 005; refers to an earlier, unspecified LLM Catalan claim — not a report of a flaw in OpenAI's paper).
- Joshua Zelinsky, Bluesky 00:25Z: "I missed Catalan and Erdos reciprocal sum in my first read through the list. This system is just eating all of math."
- Kevin Buzzard quote circulating on HN ("Six years later we are beginning to understand the answer…") is from his **pre-release** Xena post of 2026-10-01 ("To grieve, or not to grieve?"), not a reaction to this release.
- LLM-generated analyses being shared (not human expert checks): @ereliuer_eteer "Opus 5.5 on github.com/openai/math" thread (X 23:44Z, mirrored to Bluesky) asserts "The comparator statements are clean. The quasi-RH challenge is literally riemannZeta s ≠ 0 for 7/8 < s.re… Catalan is just Irrational (∑' j, (-1)^j / (2j+1)^2)" and "Some of the biggest claims have no Lean link at all: Hilbert's tenth over ℚ, L = BPL, the full BSD formula from low Selmer corank, Milne's rationality conjecture." Treat as unverified AI commentary.

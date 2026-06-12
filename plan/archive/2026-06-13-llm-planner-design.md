# LLM Planner Design

## Goal

ShellGeiAI の planner を固定ロジック中心の最小実装から、LLM を既定利用する独立コンポーネントへ移行する。  
同時に、これまでの `openingCandidates` / `assignedOpeningCandidate` を廃止し、worker ごとの探索バリエーションを表す `variants` / `assignedVariant` へ置き換える。

この変更で目指すのは、初手の違いを無理に固定することではなく、同じ問題に対して複数 worker が異なる観点で探索を始められるようにすることだ。  
シェル芸としては同じ道具立てに寄ってもよいため、planner の責務は「入口の固定」ではなく「探索観点の分散」に置く。

## Background

現状の [src/core/planner.js](/home/amanoese/repos/shellgeiai/src/core/planner.js) は、コード内の固定ロジックで `strategyProfile` と `openingCandidates` を組み立てている。  
この形は MVP としては十分だが、問題依存の探索方針を柔軟に組み立てるには限界がある。

一方で、このリポジトリは安全性、ログ再現性、責務分離を重視している。  
そのため、単純に planner 内へ LLM 呼び出しを埋め込むのではなく、独立した planner provider として切り出し、失敗時の fallback とログ記録を明示的に持つ構成が必要になる。

## Non-Goals

この設計では次を planner の責務に含めない。

- 最終コマンド文字列の生成
- 危険コマンドの許可判断
- runner や sandbox policy の変更
- selector の最終判断
- corpus 学習や自動 fine-tuning

LLM planner は「どの worker がどういう方向で探索するか」を決めるだけに留める。

## User-Facing Outcome

ユーザー視点では、`solve` の実行時に複数 worker がより意味のある分散を持って探索するようになる。  
たとえば素数問題なら、全 worker が `awk` 方向へ潰れるのではなく、同じ `awk` 系でも「一発志向」「正規化先行」「外部 utility 許容」「列挙寄り」など異なる観点を持てる。

このとき、表面的な tool 名が重複しても問題ない。  
重要なのは `opening` の違いではなく、探索方針としての `variant` が重複しすぎないことだ。

## Design Summary

planner は facade として `src/core/planner.js` に残し、実体は provider へ委譲する。  
既定では `llmPlanner` を使い、出力が不正または弱い場合だけ `ruleBasedPlanner` へ fallback する。

また、planner 契約は次のように変更する。

- 廃止: `openingCandidates`
- 廃止: `assignedOpeningCandidate`
- 追加: `variants`
- 追加: `assignedVariant`

`variant` は「最初に試す 1 手」ではなく、「この worker が主軸にする探索観点」を表す軽量な計画単位として扱う。

## Architecture

### Components

追加または再編する責務は次のとおり。

- `src/core/planner.js`
  planner facade。session を受け取り、planner provider を選び、normalized plan を返す
- `src/planner/Planner.js`
  planner provider の共通インターフェース
- `src/planner/llmPlanner.js`
  LLM で `variants` と `workerTasks` を生成する既定 provider
- `src/planner/ruleBasedPlanner.js`
  固定ロジックで `variants` を返す fallback provider
- `src/planner/plannerPrompt.js`
  planner 専用 prompt の組み立て
- `src/planner/plannerSchema.js`
  planner 出力 JSON の shape 検証と normalize
- `src/planner/plannerFallback.js`
  fallback 要否の判定
- `src/planner/plannerTelemetry.js`
  planner prompt / raw response / fallback reason / normalized plan の記録補助

### Data Flow

1. `solveSession` が problem、parallelism、mode、maxIterations など planner に必要な最小情報を集める
2. `core/planner.js` が provider を選ぶ
3. 既定 provider として `llmPlanner.buildPlan(session)` を呼ぶ
4. `plannerSchema` が JSON を parse し、必須項目と命名を normalize する
5. `plannerFallback` が品質と安全の観点で採否を判定する
6. 通れば normalized plan を返す
7. 失敗なら `ruleBasedPlanner` を呼び直す
8. planner telemetry を solve log に保存する

### Why This Boundary

この構成なら、planner の賢さを増やしても `orchestrator`、engine prompt、selector は `plan` shape だけを見ればよい。  
また、将来 `replan` や `corpus-driven planner` を追加するときも、provider を足すだけで済む。

## Plan Contract

### New Execution Plan Shape

`ExecutionPlan` は次の情報を持つ。

- `mode`
- `parallelism`
- `variants`
- `workerTasks`
- `plannerMeta`

`plannerMeta` は planner の出所と fallback 状態を後から追えるようにするためのメタ情報で、少なくとも次を含む。

- `plannerName`
- `model`
- `usedFallback`
- `fallbackReason`
- `promptVersion`

### Variant Shape

`variant` は次の shape を基本とする。

- `variantId`
- `label`
- `approach`
- `toolBias`
- `intent`
- `constraints`
- `avoid`
- `explorationHint`

意味は次のとおり。

- `label`: 人が見たときに要約しやすい短い名前
- `approach`: 探索観点の大分類
- `toolBias`: 推奨寄りの道具群。必須ではない
- `intent`: 何を先に明らかにしたい探索か
- `constraints`: この variant で守るべき方針
- `avoid`: 避けたい方向
- `explorationHint`: engine prompt へ渡す短い指示

### Worker Task Shape

`workerTask` は次の shape を持つ。

- `workerId`
- `strategy`
- `strategyProfile`
- `assignedVariant`
- `maxAttempts`

ここで `assignedVariant` は完全な 1:1 copy でもよいが、最低限 `variantId` と variant の要約が取れることを保証する。  
後段で prompt に入れるときは `assignedVariant` の要点だけを使う。

## LLM Planner Behavior

### Default On

`llmPlanner` は default `on` とする。  
CLI や設定層では、特別な理由がない限り LLM planner が使われる前提にする。

これは「将来の理想構成」へ近づくためであり、rule-based planner は通常経路ではなく fallback 経路と位置づける。

### Prompt Strategy

LLM には最終コマンドを作らせない。  
代わりに、問題文と実行条件から「複数 worker にどういう探索観点を配るべきか」を JSON で返させる。

planner prompt には少なくとも次を含める。

- 問題文
- expectedOutput があればその情報
- parallelism
- mode
- maxIterations
- ShellGeiAI が求める性質
  - concise
  - shell-gei like
  - safe
  - reproducible
- 同じ `opening` に揃ってもよいが、探索観点は分散させたいこと
- 危険コマンドや実行指示を返さず、計画だけ返すこと

### Expected Strengths

LLM planner に期待するのは次のような能力だ。

- 問題文から複数の自然な分解軸を見つける
- 同じ tool を使っても、狙いの違う variant に分ける
- shell-gei 的な美しさを壊しにくい方向を優先する
- 不要に大きな embedded script 方向へ寄せない

## Rule-Based Fallback Behavior

`ruleBasedPlanner` は現行 planner の後継として残す。  
ただし `openingCandidates` ベースではなく `variants` ベースへ修正する。

ここで重要なのは、rule-based planner も LLM planner と同じ契約を返すことだ。  
後段の consumer が planner の種類を意識してはいけない。

rule-based planner は、問題文の軽い pattern match と固定 catalog を使って variant を組み立てる。  
ただし「初手を固定する」発想は捨て、次のような探索観点を返す。

- direct one-liner bias
- normalization-first
- enumeration-driven
- filter decomposition
- external utility tolerant

## Fallback Policy

LLM planner の出力は次の条件を満たすときだけ採用する。

- JSON schema に合う
- `parallelism` と `workerTasks.length` が整合する
- 各 worker に `assignedVariant` がある
- `variants` が空でない
- variant 内容が極端に重複しない
- `explorationHint` が空でない
- 危険コマンド実行を促す文言を含まない

fallback の主なトリガは次のとおり。

- JSON parse failure
- schema mismatch
- variant duplication too high
- unknown field explosion
- harmful or execution-oriented instructions
- model timeout
- provider unavailable

fallback した場合は、理由を人間と replay の両方が追える形で残す。

## Logging And Reproducibility

planner は solve の入り口なので、ここでの判断は必ず再現可能であるべきだ。

solve log には少なくとも次を残す。

- `planner.name`
- `planner.model`
- `planner.promptVersion`
- `planner.usedFallback`
- `planner.fallbackReason`
- `planner.rawResponse`
- `planner.normalizedPlan`
- `plan.variants`
- `plan.workerTasks[].assignedVariant`

必要なら verbose mode で prompt 本文も残せるようにしてよいが、ログサイズとのバランスを見る。  
最低限、prompt version と raw response があれば後から検証可能にできる。

## Prompting Implications For Engines

engine prompt も `opening candidate` 前提から `assignedVariant` 前提へ置き換える必要がある。

重要なのは、variant が「最初の 1 手を固定する命令」にならないことだ。  
engine には次のような弱い拘束として渡す。

- この worker の主軸は何か
- どの性質を優先したいか
- 何を避けたいか
- 次に広げるならどの方向か

これにより、同じ `awk` に見える候補でも、worker ごとに探索姿勢を分けられる。

## Safety Model

LLM planner を入れても、安全責務は planner に持たせない。

- planner は command policy を緩めない
- planner は sandbox policy を変更しない
- planner は command を実行しない
- planner は「危険でもよいから試せ」と指示しない

危険な提案を完全に防げなくても、planner fallback と既存 safety layer で吸収する前提にする。

## Migration Plan

### Phase 1: Contract Rename

まず `openingCandidates` と `assignedOpeningCandidate` を廃止し、`variants` と `assignedVariant` へ置き換える。  
この段階では中身はまだ rule-based でもよい。

### Phase 2: Provider Split

現行 planner ロジックを `ruleBasedPlanner` へ移す。  
`src/core/planner.js` は facade に変える。

### Phase 3: LLM Planner Introduction

`llmPlanner` を追加し、default `on` にする。  
ただし、schema / fallback / telemetry が揃うまでは実験フラグで隔離してもよい。

### Phase 4: Logging And Replay

planner raw response と normalized plan を solve log に保存する。  
replay や比較で planner の振る舞いを確認しやすくする。

### Phase 5: Quality Evaluation

rule-based planner と llmPlanner を比較する。  
特に次を観測する。

- passing rate
- best candidate quality
- variant diversity
- average solve latency
- fallback frequency

## Success Criteria

この設計の成功条件は次のとおり。

- default 経路で llmPlanner が安定して有効 plan を返す
- variant 契約への移行で `opening` 依存が消える
- worker 間の探索観点が重複しすぎない
- shell-gei quality を落とさず passing rate か best candidate quality が改善する
- fallback 時も solve 全体は壊れず継続する
- ログから planner 判断が追跡できる

## Risks

### Over-Planning

LLM planner が説明過剰になり、variant が抽象的すぎる恐れがある。  
対策として、schema を短く保ち、`explorationHint` を 1-2 文に制限する。

### Fake Diversity

見た目だけ違う variant を量産し、実際には同じ探索になる恐れがある。  
対策として、variant 重複判定を `toolBias` だけでなく `intent` と `avoid` も含めて行う。

### Latency Increase

planner の 1 回分だけ solve 開始が遅くなる。  
対策として、planner 用モデルは worker より軽量でもよい設計にする。

### Unsafe Suggestions

planner が危険寄りの方向を示す恐れがある。  
対策として、prompt 制約、schema check、fallback、既存 safety layer の四重で防ぐ。

## Open Questions Resolved In This Design

### Should opening remain?

No.  
`opening` は planner 契約から外す。  
シェル芸では同じ道具立てから入ること自体は問題ではなく、分散させたいのは探索観点だからだ。

### Should llmPlanner be default on?

Yes.  
理想寄り設計としては `llmPlanner` を既定にし、`ruleBasedPlanner` は fallback に回す。

### Should ruleBasedPlanner keep old semantics?

No.  
rule-based planner も同じく `variant` 契約へ寄せる。  
fallback 時だけ古い意味論に戻る設計は、後段を複雑にするため採用しない。

## Implementation Readiness

この設計は 1 本の implementation plan に落とし込める粒度に収まっている。  
主な変更点は planner 境界、plan 契約、engine prompt、logs、tests に集中しており、独立した task へ分解しやすい。

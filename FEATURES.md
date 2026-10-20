# Features

<!-- repository-creator:managed:start -->

## Role

プロダクトが何をするかと、その機能をどこまで充実させるかを扱う。コア機能、機能拡充、ユーザーフロー、状態、業務ルール、権限、データ、外部連携を対象とする。コンテンツは `CONTENT.md`、見せ方は `DESIGN.md` の責務とする。

## Goal

初回は中心価値を成立させるコア機能へ集中する。コア完成後は、完成した実物を基準に不足を評価し、継続利用に必要な機能群をまとめて拡充してプロダクトレベルへ育てる。最初から周辺機能へ拡散することも、一機能ずつ細切れに増やすことも目的にしない。

## Core Establishment

- 対象ユーザー、中心価値、主要フローを確認し、入口から結果までを成立させるコア機能群を定める。
- 保存、空、読込中、失敗、取消・復帰など、中心体験に不可欠な状態はコアの完成条件として扱う。
- 複数の周辺機能へ広く着手せず、主要フローを高品質に完成させる。
- 実際に主要フローを使用して完了条件を確認し、見かけ上動くだけの状態を完成としない。

## Product Expansion

- コア完成後に、初回利用、反復利用、継続利用までのフロー全体と現在の機能を改めて評価する。
- 必要なら実在する類似・隣接プロダクトを調査し、重大な欠落、利用中断の原因、継続利用に必要な能力を洗い出す。
- 機能候補を列挙し、ユーザー価値、中心体験との接続、品質、複雑化、維持負担で `採用`、`保留`、`見送り` に分ける。
- 次に目指す完成状態を定め、採用した関連機能群を一つの `Expansion Set` として選ぶ。
- `Expansion Set` を一機能や一テーマへ限定しない。AIが一度に高品質で統合・検証でき、次の完成状態へ意味のある進歩を作れる範囲を基準にする。
- 既存機能との接続、データ、状態、権限、失敗時の振る舞いまで完成させ、独立した機能の寄せ集めにしない。
- 実装後は主要フローと重要な失敗系を検証し、プロダクト全体を再評価する。次に採用すべき重要な候補があれば反復する。

## Workflow Handoff

この領域の `Expansion Set` を実装・検証したことは、プロダクト全体の作業完了を意味しない。

- 機能領域で採用した改善の実装と確認が終わったら、必ず `WORKFLOW.md` のプロダクト全体再評価へ戻る。
- この文書単独ではタスクの最終完了を判断しない。
- 機能改善を一周したこと、主要フローのテストが成功したこと、現在の `Expansion Set` を完了したことを理由に作業を終了してはならない。
- `WORKFLOW.md` の全体再評価で新たに1件以上の改善が `採用` された場合、タスクは未完了であり、そのまま次の実装・検証・再評価へ進む。
- 最終的な継続・終了判定は `WORKFLOW.md` の終了条件に従う。

## Records

- コード、API仕様、テスト、Issueで十分に表現される詳細を重複して書かない。
- 現在の成熟度、コアの完了条件、次の完成状態、現在の `Expansion Set`、保留・見送り理由、長く維持すべき判断だけを下に残す。

<!-- repository-creator:managed:end -->

## Project Feature Maturity


- Product / users / core outcome: iPhoneを中心に、曲へリアルタイムで音声エフェクトを重ねて遊ぶブラウザデッキ。
- Current maturity: 6エフェクト、同梱9曲、ローカル読込、シーク、ループ、タップ・長押し・キーボード操作が実装済み。
- Important flows / states / data decisions: 音声は端末内のWeb Audio / AudioWorkletで処理し、読み込み競合は最後の選択を優先する。中断したAudioContextは再生操作で再開する。エフェクトの強さは100%固定、音色・速さ・間隔を各パッドの縦ドラッグで個別に調整する。
- Deferred or rejected items / reasons: 録音・書き出し、アカウント保存、外部配信サービス連携は現在の中心体験に含めない。

- iPhone audio routing: 対応ブラウザではAudioSessionを音楽再生用に設定する。音声の初期化に失敗しても再試行を案内し、音源の読み込み完了後なら再取得せず再生を再試行する。
- Playback fallback: 専用音声処理が使えない場合も基本再生と利用可能なエフェクトを提供し、非対応パッドを無効化して簡易モードを表示する。

- Performance controls: 初期モードは長押し。指ごとの操作とパラメータを独立して管理し、指を離したパッドだけを解除する。パラメータは指を離しても保持する。
- Gesture handling: 演奏面内のピンチ・ジェスチャーだけを抑止し、複数パッドの同時操作を妨げるブラウザ拡大縮小を防ぐ。

## Effect Reference and Scope

- Fidelity target: K-Shoot MANIAの公開エフェクト仕様を処理モデルの参考にする。KONAMI公式で確認したのはFX長押しとアナログ操作であり、本家のDSPや全譜面の再現を主張しない。6パッドと上下操作はこのアプリ独自の操作方法。
- DSP decisions: BitCrusherはサンプル保持、Flangerは約0.68–1.70msの短い遅延と拍同期、LPFは自動揺れを加えないカットオフ操作。Gateは50%デューティで無音まで切り、Retriggerは押下以降の音を反復して2拍ごとに更新する。Echoは再取り込みなしの反復に毎回60%の減衰を加える。初期ミックスは100%とし、原音の漏れで処理が弱まらないようにする。
- Startup resilience: 外部フォントは非同期に読み込み、フォント配信の遅延・失敗でアプリの初期化や再生操作を待たせない。
- Short-delay implementation: フィードバック付きFlangerはAudioWorklet内でサンプル単位に処理する。標準DelayNodeの循環接続では遅延が最低1 render quantumへ制限されるため、約1msの遅延をAudioParamの表示だけで検証しない。簡易モードはフィードバックを省いたFlangerとLPFを提供する。[Web Audio仕様](https://webaudio.github.io/web-audio-api/#dom-delaynode-delaytime)。
- Musical parameters: Gate・Retrigger・Echoは4/4小節に対する音符の分割を用い、三連符も選べる。サンプル保持時間は44.1kHzの基準から実行時のサンプルレートへ換算する。各パッドには割合だけでなく処理単位を表示する。
- Source boundaries: LPFの周波数・QはK-Shoot仕様でも実装依存。本家の数値として扱わず、公開実装を参考に独自の範囲と音量を調整する。PhaserはFlangerと異なる処理のため混同しない。追加エフェクト・譜面の読込・自動BPM検出は今回の範囲に含めない。
- References: [KONAMI・SDVXの遊び方](https://p.eagate.573.jp/game/sdvx/vii/howto/play.html)、[K-Shoot公開エフェクト仕様](https://github.com/kshootmania/ksm-chart-format/blob/b984509ad6b43c208f8a3b4aff51d6a8664b896d/kson_format.md#L454-L586)、[LPFの実装依存パラメータ](https://github.com/kshootmania/ksm-chart-format/blob/b984509ad6b43c208f8a3b4aff51d6a8664b896d/kson_format.md#L639-L654)、[USC公開プリセット](https://github.com/Drewol/unnamed-sdvx-clone/blob/260b050569413a04db9d437c5158d2a032873ad6/Beatmap/src/AudioEffects.cpp#L48-L72)。K-ShootとUSCはSDVX公式仕様ではない。

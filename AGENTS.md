# AGENTS.md

このリポジトリで AI エージェントや開発者が迷いやすい運用メモです。

## リリース手順

`scribe` CLI も更新される必要があるため、リリース時は次を必ず確認します。

1. `main` が `origin/main` と一致していることを確認する。
2. `src/version.ts` の `VERSION` を新しいリリース番号に更新する。
   - `scribe version` / `scribe --version` はこの値を表示する。
3. 変更に応じてテストを実行する。
   - `deno test --config src/deno.json`
   - 変更対象に応じて `deno check --config src/deno.json ...`
4. 新しい `v*` タグを作成して push する。
   - `.github/workflows/release.yml` がタグ push をトリガーに `scribe` CLI の macOS / Linux / Windows バイナリを GitHub Release にアップロードする。
5. GitHub Release を作成し、Release workflow が成功して asset が揃ったことを確認する。
6. Homebrew tap を更新する。
   - Tap: `ele-inc/homebrew-tap`
   - Formula: `Formula/scribe.rb`
   - この formula は GitHub Release asset ではなく git tag から source build するため、`tag:` と `revision:` を新しいリリースに更新する。
   - 例: `tag: "v0.4.0"` と、その tag が指す commit hash。
7. Cloud Run の Bot を更新する場合は、このリポジトリの `scripts/deploy.sh` または `make deploy` を使う。
   - `gcloud` が再認証を要求する場合は非対話実行では続行できないため、ユーザー側で `gcloud auth login` が必要。

## 補足

- 全体の `deno check` は、既存スクリプト側の型エラーで止まることがある。リリース前確認では、変更対象ファイルに絞った `deno check` も併用する。
- Homebrew でインストールしているユーザーに `scribe` の更新を届けるには、GitHub Release だけでは不十分。必ず `ele-inc/homebrew-tap` も更新する。

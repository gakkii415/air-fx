# AIR FX

[ブラウザで使う](https://gakkii415.github.io/air-fx/)

曲を長押しエフェクトで加工して遊ぶ、スマートフォン向けの静的Web Audioデッキ。iPhone 16の縦横画面に対応し、メイン画面はスクロールなしで操作できます。6つのエフェクトは横一列に並び、各パッド内に縦のパラメータ表示があります。

- サンプル保持、短い遅延のFlanger、LPF、拍同期のGate・Retrigger、減衰するEchoの6種類。パッドには音符の長さや処理の単位を表示します。
- 強さは常に100%。初期ミックスは原音を混ぜない100%。パッドを押している間だけONになり、押したまま上下に動かすと、そのエフェクトの音色・速さ・間隔を変えられます。
- 複数の指で別々のパッドを操作できます。演奏面のピンチによる拡大縮小を抑止します。
- 曲選択は一覧、ミックスとテンポは調整ダイアログ。ローカルファイルは端末内で処理し、アップロードしません。
- PCではA/S/D/J/K/Lを長押し。フォーカスしたパッドはSpace/EnterでON、上下キーでパラメータ調整。Spaceで再生・一時停止。

## ローカル起動

```sh
python -m http.server 4173
```

http://localhost:4173 を開きます。ビルドや依存ライブラリは不要です。外部ホストではHTTPSが必要です。

## 音源とライセンス

収録音源は128kbps MP3へ再エンコードしています。再生時のエフェクトで音が変わります。正確なメタデータと帰属表示は `tracks.json` およびアプリ内クレジットに保持します。

- **Unity — TheFatRat**: [配布元](https://www.newgrounds.com/audio/listen/621134) · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- **Cipher — Kevin MacLeod**: [配布元](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100844) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **EDM Detection Mode — Kevin MacLeod**: [配布元](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1500026) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Club Diver — Kevin MacLeod**: [配布元](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1200020) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Cloud Dancer — Kevin MacLeod**: [配布元](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN2300007) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Exit the Premises — Kevin MacLeod**: [配布元](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1500029) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Sphere — Creo**: [配布元](https://www.newgrounds.com/audio/listen/739991) · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- **Dimension — Creo**: [配布元](https://www.newgrounds.com/audio/listen/709578) · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- **Place On Fire — Creo**: [配布元](https://www.newgrounds.com/audio/listen/847116) · [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)

アルバムの図柄は独自の幾何学表現です。SOUND VOLTEXの公式サービスではありません。録音・書き出しは含みません。

## エフェクトの参考仕様

音声処理は、[公開エフェクト仕様](https://github.com/kshootmania/ksm-chart-format/blob/b984509ad6b43c208f8a3b4aff51d6a8664b896d/kson_format.md#L454-L586)を参考にした独自実装です。BitCrusherはサンプル保持、Gateは無音まで切る処理、Retriggerは押した瞬間からの反復、Echoは反復ごとの減衰として実装します。公式製品のDSPや全譜面のエフェクトを再現するものではありません。

function createSuggestion(summary, rationale, suggestedTools) {
  return { summary, rationale, suggestedTools };
}

export function seedToolSuggestions(problemText) {
  const text = String(problemText ?? "");
  const lowerText = text.toLowerCase();
  const suggestions = [
    createSuggestion(
      "まずは単一 pass の集約や抽出を疑う",
      "多くのシェル芸問題は標準 text utility の組み合わせで短く解ける",
      ["awk", "sed", "grep", "cut"]
    )
  ];

  if (/prime|素数/.test(text) || lowerText.includes("prime")) {
    suggestions.unshift(
      createSuggestion(
        "既存 utility で判定を表現できるかを先に試す",
        "標準コマンドがハマると短く shell-gei らしい解法になりやすい",
        ["factor", "seq", "awk"]
      )
    );
  }

  if (/csv|tsv|column|列|区切/.test(text) || /csv|tsv|column/.test(lowerText)) {
    suggestions.push(
      createSuggestion(
        "列単位の整形や抽出を先に切り出す",
        "区切り文字が明確な問題は列指向ツールから入ると探索が安定する",
        ["cut", "awk", "paste", "tr"]
      )
    );
  }

  return suggestions;
}

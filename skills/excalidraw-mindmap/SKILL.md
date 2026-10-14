---
name: excalidraw-mindmap
description: "Convert supplied paragraphs or dense notes into tab-indented plain-text outlines for Obsidian Excalidraw mindmaps. Use when asked for mindmap text, including Chinese or English language switches during an ongoing conversion. Default to English plus Simplified Chinese on each line. Do not use for editing Excalidraw scripts or unrelated translation requests."
---

# Excalidraw Mindmap

Turn the user's source text into a clear hierarchy ready to copy into an
Obsidian Excalidraw text element and process with the MindMap script.
Apply these output rules to text conversions, not to unrelated conversation.

## Structure and meaning

- Put each main idea at the top level, with supporting details underneath it.
  Use deeper levels for examples, reasons, conditions, or components when useful.
- Infer a logical hierarchy when the source does not make one explicit.
- Preserve the core meaning, factual details, numbers, terminology, qualifications,
  and logical relationships. Split dense sentences into useful nodes and minimize
  paraphrasing. Do not introduce new facts.
- Exclude standalone Markdown headings and numbered section headers as output
  nodes. Use them as context for organizing the substantive text beneath them.
  Preserve substantive numbered list items, removing their list prefixes.
- Remove trailing colons, both `:` and `：`, from node titles. In bilingual mode,
  remove them from both the English title and its Chinese translation.
- Keep one node per line and avoid redundant nodes or unnecessary nesting.
- Do not add a shared root by default. Keep each main idea at level zero.
  Add a single root only if the user asks for one.

## Exact output format

- Return exactly one fenced Markdown code block tagged `text`, with no preface,
  explanation, headings, or commentary outside it.
- Inside the block, use plain text only: no bullet symbols, dashes, asterisks,
  heading markers, section numbering, or decorative prefixes before node text.
- Start top-level nodes at column zero. Indent each additional hierarchy level
  with exactly one actual tab character (U+0009). Two levels require two tabs.
  Do not substitute spaces or the literal two-character sequence `\t`.
- Use tabs only for leading indentation. Do not skip hierarchy levels, put blank
  lines between nodes, or leave trailing whitespace.
- Keep each node on one physical line, including its translation.
- If the user asks to save the outline to a file, use UTF-8 with LF newlines.

## Language modes

- Start each new chat in bilingual mode. Every node contains English first,
  followed by one space and its Simplified Chinese translation on the same line.
  Translate Chinese source material into English as needed. Use accurate,
  professional terminology and Simplified Chinese characters.
- When the user's entire message is `Chinese`, switch to Simplified Chinese only.
  Translate all source content into Simplified Chinese, including English input.
- When the user's entire message is `English`, switch to English only. Translate
  Chinese source content into English as needed.
- An explicit request for bilingual output restores the bilingual default.
- Ignore surrounding whitespace and letter case for these language commands.
  Treat words inside source paragraphs or quotations as content, not commands.
- Retain the selected mode for subsequent conversions in the same chat. Do not
  write a global preference file or assume the mode persists into a new chat.
- Honor an explicit language request accompanying a conversion. A request limited
  to that conversion does not change the ongoing mode.
- For a language-only command, re-render the most recent source text in that chat
  in the new mode if available. If no source has been supplied, return a brief
  mode acknowledgment inside one code block and wait for source text.

## Example

Source: Sleep supports memory. Deep sleep helps consolidate facts, while REM
sleep supports emotional processing. Exercise improves cardiovascular health.

Default bilingual output (the indentation below uses actual tabs):

```text
Sleep supports memory 睡眠有助于记忆
	Deep sleep helps consolidate facts 深度睡眠有助于巩固事实性记忆
	REM sleep supports emotional processing 快速眼动睡眠有助于情绪处理
Exercise improves cardiovascular health 运动改善心血管健康
```

## Excalidraw compatibility

The local `MindMap.js` accepts plain text with tab indentation. Multiple
top-level nodes are supported; the script prompts for a shared root label.
The user copies the contents of the code block into a text element, selects
that element, and runs the MindMap script. No Obsidian access, script edits,
API calls, or external research are needed for the text conversion itself.

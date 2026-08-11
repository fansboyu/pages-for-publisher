<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Jodit } from "jodit";
import "jodit/es2021/jodit.min.css";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const host = ref<HTMLTextAreaElement | null>(null);
let instance: Jodit | null = null;
const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:3003";

function toggleHtmlSource() {
  // 使用本地 textarea 源码编辑器，不依赖境外 CDN 加载 Ace。
  instance?.toggleMode();
}

onMounted(() => {
  if (!host.value) return;

  instance = Jodit.make(host.value, {
    height: 440,
    minHeight: 360,
    toolbarAdaptive: false,
    toolbarSticky: false,
    language: "zh_cn",
    spellcheck: true,
    sourceEditor: "area",
    showCharsCounter: false,
    showWordsCounter: false,
    showXPathInStatusbar: false,
    placeholder: "请输入文章正文内容，支持粘贴完整富文本、内嵌样式、图片和链接",
    // 使用 Jodit 免费版默认完整工具栏，而非此前的精简白名单。
    // 包含格式、字体字号、颜色、段落、媒体、表格、分割线、特殊字符、
    // 查找替换、撤销重做、全屏与源码 HTML 等所有已加载的免费控件。
    buttons: Jodit.defaultOptions.buttons,
    cleanHTML: {
      // 保留外部内容系统带来的 section/div/span 和内嵌 style，
      // 同时仍移除事件属性与 javascript: 链接。
      allowedStyles: false,
      removeEventAttributes: true,
      safeJavaScriptLink: true,
      safeLinksTarget: true,
      fillEmptyParagraph: false,
    },
    uploader: {
      url: `${apiBase}/portal/v1/uploads/images`,
      method: "POST",
      format: "json",
      insertImageAsBase64URI: false,
      filesVariableName: () => "file",
      headers: () => {
        const token = localStorage.getItem("publisher-access");
        return token ? { Authorization: `Bearer ${token}` } : null;
      },
      isSuccess: (response: any) => Boolean(response?.url),
      getMessage: (response: any) => response?.message || "图片上传失败",
      process: (response: any) => ({
        files: response?.url ? [response.url] : [],
        path: "",
        baseurl: "",
      }),
    },
  } as any);

  instance.value = props.modelValue || "";
  instance.events.on("change.publisher", (value: string) => {
    emit("update:modelValue", value);
  });
});

watch(
  () => props.modelValue,
  (value) => {
    if (instance && instance.value !== (value || "")) instance.value = value || "";
  },
);

onBeforeUnmount(() => {
  instance?.destruct();
  instance = null;
});
</script>

<template>
  <div class="rich-editor-wrap">
    <div class="html-source-guide">
      <div>
        <strong>HTML 源码编辑</strong>
        <span>可直接粘贴带 <code>style</code> 的完整 HTML；切回可视化模式即可预览排版。</span>
      </div>
      <button type="button" class="html-source-button" @click="toggleHtmlSource">
        &lt;/&gt; 切换 HTML 源码模式
      </button>
    </div>
    <textarea ref="host" />
  </div>
</template>

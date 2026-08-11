<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Jodit } from "jodit";
import "jodit/es2021/jodit.min.css";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const host = ref<HTMLTextAreaElement | null>(null);
let instance: Jodit | null = null;
const apiBase = import.meta.env.VITE_API_BASE_URL || "http://localhost:3003";

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
    // 将源码模式固定放在工具栏最左侧；点击一次编辑 HTML，再点击回到预览。
    // 其余保持 Jodit 免费版的完整常用工具栏。
    buttons: [
      "source",
      "|",
      ...(Jodit.defaultOptions.buttons as any[]).filter(
        (item: any) => !(typeof item === "object" && item?.group === "source"),
      ),
    ],
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
  <div class="rich-editor-wrap"><textarea ref="host" /></div>
</template>

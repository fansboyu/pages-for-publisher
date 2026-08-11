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
    useSplitMode: false,
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
    controls: {
      // 强制只在“可视化 / 源码”两种状态间切换，不进入分屏模式。
      source: {
        icon: "source",
        tooltip: "HTML 源码 / 可视化预览",
        // 位掩码 1 + 2：可视化和源码模式下都显示且可点击。
        mode: (Jodit as any).MODE_WYSIWYG + (Jodit as any).MODE_SOURCE,
        exec: (editor: Jodit) => {
          const enterSource =
            editor.getRealMode() !== (Jodit as any).MODE_SOURCE;
          editor.setMode(
            enterSource
              ? (Jodit as any).MODE_SOURCE
              : (Jodit as any).MODE_WYSIWYG,
          );
          // Jodit 的源码插件仅在处于源码模式时同步镜像内容。
          // 因此切换完成后触发一次 change，把可视化 HTML 写入源码编辑区。
          if (enterSource) editor.events.fire("change");
        },
      },
    },
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

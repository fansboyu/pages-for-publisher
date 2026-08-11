<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Document,
  FolderOpened,
  Grid,
  Plus,
  Tickets,
  UserFilled,
  User,
} from "@element-plus/icons-vue";
import RichEditor from "./RichEditor.vue";
import {
  api,
  auth,
  type Article,
  type Category,
  type Site,
  type User as UserType,
} from "./api";
const account = ref<UserType | null>(null),
  login = ref({ username: "", password: "" }),
  busy = ref(false),
  page = ref("sites"),
  sites = ref<Site[]>([]),
  selected = ref<Site | null>(null),
  articles = ref<Article[]>([]),
  jobs = ref<any[]>([]),
  categories = ref<Category[]>([]),
  statusFilter = ref(""),
  clientFilter = ref(""),
  dashboard = ref<any>(null),
  clients = ref<any[]>([]),
  editor = ref(false),
  preview = ref(false),
  editing = ref<Article | null>(null),
  article = ref<any>({
    title: "",
    slug: "",
    category_id: "",
    tags: [],
    summary: "",
    content_html: "",
    cover_image_url: "",
    seo_title: "",
    seo_description: "",
    status: "published",
  }),
  categoryDialog = ref(false),
  categoryName = ref(""),
  siteDialog = ref(false),
  editingSite = ref<Site | null>(null),
  siteForm = ref<any>({
    client_id: "",
    name: "",
    domain: "",
    repository_url: "",
    template_key: "generic-static",
    source_branch: "master",
    publish_branch: "publish",
    template_root: ".",
    pages_project_name: "",
  }),
  clientDialog = ref(false),
  client = ref<any>({
    name: "",
    contact_name: "",
    contact_phone: "",
    owner_username: "",
    owner_password: "",
    owner_display_name: "",
  });
const admin = computed(() => account.value?.role === "platform_admin");
const selectableSites = computed(() =>
  admin.value && clientFilter.value
    ? sites.value.filter((site) => site.clientId === clientFilter.value)
    : sites.value,
);
const clientName = (clientId: string) =>
  clients.value.find((item) => item.id === clientId)?.name || "未命名客户";
async function load() {
  if (!account.value) return;
  sites.value = await api.sites();
  if (admin.value) {
    dashboard.value = await api.adminDashboard();
    clients.value = await api.adminClients();
  }
  if (sites.value.length && !selected.value) await choose(sites.value[0]);
}
async function signIn() {
  busy.value = true;
  try {
    const r = await api.login(login.value.username, login.value.password);
    auth.set(r.access_token);
    account.value = r.user;
    await load();
    ElMessage.success("登录成功");
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "登录失败");
  } finally {
    busy.value = false;
  }
}
async function restore() {
  if (!localStorage.getItem("publisher-access")) return;
  try {
    account.value = await api.me();
    await load();
  } catch {
    auth.clear();
  }
}
async function choose(site: Site, navigate = false) {
  selected.value = site;
  if (navigate) page.value = "articles";
  [articles.value, jobs.value, categories.value] = await Promise.all([
    api.articles(site.id, statusFilter.value),
    api.jobs(site.id),
    api.categories(site.id),
  ]);
}
async function switchSite(id: string) {
  const site = sites.value.find((item) => item.id === id);
  if (site) await choose(site);
}
async function switchClient(id: string) {
  clientFilter.value = id;
  const next =
    selectableSites.value.find((site) => site.id === selected.value?.id) ||
    selectableSites.value[0];
  if (next) await choose(next);
  else {
    selected.value = null;
    articles.value = [];
    jobs.value = [];
    categories.value = [];
  }
}
async function refreshArticles() {
  if (selected.value)
    articles.value = await api.articles(selected.value.id, statusFilter.value);
}
function newArticle() {
  editing.value = null;
  article.value = {
    title: "",
    slug: "",
    category_id: "",
    tags: [],
    summary: "",
    content_html: "",
    cover_image_url: "",
    seo_title: "",
    seo_description: "",
    status: "published",
  };
  editor.value = true;
}
function edit(a: Article) {
  editing.value = a;
  article.value = {
    title: a.title,
    slug: a.slug,
    category_id: a.categoryId || "",
    tags: a.tags || [],
    summary: a.summary,
    content_html: a.contentHtml,
    cover_image_url: a.coverImageUrl || "",
    seo_title: a.seoTitle || "",
    seo_description: a.seoDescription || "",
    status: a.status,
  };
  editor.value = true;
}
async function uploadCover(file: any) {
  if (!file.raw) return;
  busy.value = true;
  try {
    article.value.cover_image_url = (await api.uploadImage(file.raw)).url;
    ElMessage.success("封面图上传成功");
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "上传失败");
  } finally {
    busy.value = false;
  }
}
async function saveArticle() {
  if (!selected.value) return;
  busy.value = true;
  try {
    const payload = {
      ...article.value,
      slug: article.value.slug?.trim() || undefined,
      category_id: article.value.category_id || undefined,
      cover_image_url: article.value.cover_image_url?.trim() || undefined,
      seo_title: article.value.seo_title?.trim() || undefined,
      seo_description: article.value.seo_description?.trim() || undefined,
    };
    if (editing.value)
      await api.updateArticle(selected.value.id, editing.value.id, payload);
    else await api.createArticle(selected.value.id, payload);
    editor.value = false;
    await choose(selected.value);
    ElMessage.success("文章已保存，发布任务已进入队列");
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "保存失败");
  } finally {
    busy.value = false;
  }
}
async function removeArticle(a: Article) {
  if (!selected.value) return;
  await ElMessageBox.confirm(`确定删除文章“${a.title}”吗？`, "删除文章", {
    type: "warning",
  });
  await api.removeArticle(selected.value.id, a.id);
  await choose(selected.value);
  ElMessage.success("文章已删除，发布任务已进入队列");
}
async function restoreArticle(a: Article) {
  if (!selected.value) return;
  await api.restoreArticle(selected.value.id, a.id);
  await refreshArticles();
  ElMessage.success("文章已恢复为草稿");
}
async function saveCategory() {
  if (!selected.value || !categoryName.value.trim()) return;
  try {
    await api.createCategory(selected.value.id, categoryName.value.trim());
    categoryName.value = "";
    categoryDialog.value = false;
    categories.value = await api.categories(selected.value.id);
    ElMessage.success("分类已创建");
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "创建失败");
  }
}
function newSite() {
  editingSite.value = null;
  siteForm.value = {
    client_id: "",
    name: "",
    domain: "",
    repository_url: "",
    template_key: "generic-static",
    source_branch: "master",
    publish_branch: "publish",
    template_root: ".",
    pages_project_name: "",
  };
  siteDialog.value = true;
}
function editSite(site: Site) {
  editingSite.value = site;
  siteForm.value = {
    client_id: site.clientId,
    name: site.name,
    domain: site.domain,
    repository_url: site.repositoryUrl,
    template_key: site.templateKey,
    source_branch: site.sourceBranch,
    publish_branch: site.publishBranch,
    template_root: site.templateRoot,
    pages_project_name: site.pagesProjectName || "",
  };
  siteDialog.value = true;
}
async function saveSite() {
  busy.value = true;
  try {
    if (editingSite.value) {
      const { client_id, ...payload } = siteForm.value;
      const updated = await api.updateSite(editingSite.value.id, payload);
      sites.value = await api.sites();
      if (selected.value?.id === updated.id) selected.value = updated;
      siteDialog.value = false;
      ElMessage.success("站点配置已保存，下次发布将使用新配置");
      return;
    }
    const result = await api.createSite(siteForm.value);
    sites.value = await api.sites();
    siteDialog.value = false;
    await ElMessageBox.alert(
      `请立即保存该站点的 Webhook Key：\n\n${result.api_key}\n\n该 Key 仅显示一次，用于 AI/外部系统发布文章。`,
      "站点创建成功",
      { confirmButtonText: "我已保存" },
    );
    ElMessage.success("官网站点已创建，请在文章管理中选择客户和站点");
  } catch (e) {
    ElMessage.error(
      e instanceof Error
        ? e.message
        : editingSite.value
          ? "站点配置保存失败"
          : "站点创建失败",
    );
  } finally {
    busy.value = false;
  }
}
async function saveClient() {
  try {
    await api.createClient(client.value);
    clientDialog.value = false;
    clients.value = await api.adminClients();
    ElMessage.success("客户已创建");
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : "创建失败");
  }
}
function logout() {
  auth.clear();
  account.value = null;
  selected.value = null;
  sites.value = [];
}
onMounted(restore);
</script>
<template>
  <main v-if="!account" class="login">
    <section>
      <div class="mark">SG</div>
      <p class="eyebrow">SHUGAOXING CONTENT CLOUD</p>
      <h1>数告星发布中心</h1>
      <p>上海数告星网络科技有限公司 · 统一管理官网、文章内容与自动发布任务。</p>
    </section>
    <el-card class="login-card"
      ><h2>登录</h2>
      <el-form label-position="top"
        ><el-form-item label="账号"
          ><el-input
            v-model="login.username"
            placeholder="请输入账号" /></el-form-item
        ><el-form-item label="密码"
          ><el-input
            v-model="login.password"
            type="password"
            show-password
            placeholder="请输入密码"
            @keyup.enter="signIn" /></el-form-item
        ><el-button class="wide" type="primary" :loading="busy" @click="signIn"
          >登录</el-button
        ></el-form
      ></el-card
    >
  </main>
  <el-container v-else class="app"
    ><aside>
      <div class="logo">
        <span>SG</span><b>数告星<small>CONTENT CLOUD</small></b>
      </div>
      <div class="role">
        <el-icon><UserFilled /></el-icon
        >{{ admin ? "平台管理员" : "客户负责人" }}
      </div>
      <nav>
        <button :class="{ active: page === 'sites' }" @click="page = 'sites'">
          <el-icon><FolderOpened /></el-icon>官网站点</button
        ><button
          :class="{ active: page === 'articles' }"
          :disabled="!selected"
          @click="page = 'articles'"
        >
          <el-icon><Document /></el-icon>文章管理</button
        ><button
          :class="{ active: page === 'jobs' }"
          :disabled="!selected"
          @click="page = 'jobs'"
        >
          <el-icon><Tickets /></el-icon>发布任务</button
        ><button
          v-if="admin"
          :class="{ active: page === 'clients' }"
          @click="page = 'clients'"
        >
          <el-icon><User /></el-icon>客户管理</button
        ><button
          v-if="admin"
          :class="{ active: page === 'overview' }"
          @click="page = 'overview'"
        >
          <el-icon><Grid /></el-icon>平台概览
        </button>
      </nav>
      <button class="logout" @click="logout">退出登录</button>
    </aside>
    <el-container
      ><section class="body">
        <template v-if="page === 'overview' && admin"
          ><div class="heading">
            <div>
              <p class="eyebrow">PLATFORM OVERVIEW</p>
              <h1>发布平台概览</h1>
            </div>
          </div>
          <div class="metrics">
            <article>
              <span>客户数量</span><b>{{ dashboard?.metrics.clients || 0 }}</b>
            </article>
            <article>
              <span>官网数量</span><b>{{ dashboard?.metrics.sites || 0 }}</b>
            </article>
            <article>
              <span>已发布文章</span
              ><b>{{ dashboard?.metrics.published_articles || 0 }}</b>
            </article>
            <article>
              <span>失败任务</span
              ><b>{{ dashboard?.metrics.failed_jobs || 0 }}</b>
            </article>
          </div></template
        >
        <template v-else-if="page === 'sites'"
          ><div class="heading">
            <div>
              <p class="eyebrow">WEBSITES</p>
              <h1>{{ admin ? "全部官网" : "我的官网" }}</h1>
              <p>选择一个官网，进入文章内容管理。</p>
            </div>
            <el-button v-if="admin" type="primary" :icon="Plus" @click="newSite"
              >新增官网站点</el-button
            >
          </div>
          <el-empty
            v-if="!sites.length"
            description="暂无官网站点，请先创建一个站点"
            ><el-button v-if="admin" type="primary" @click="newSite"
              >创建官网站点</el-button
            ></el-empty
          >
          <div v-else class="site-grid">
            <article v-for="s in sites" :key="s.id" class="site-card">
              <span class="site-letter">{{ s.name.slice(0, 1) }}</span>
              <h3>{{ s.name }}</h3>
              <a :href="`https://${s.domain}`" target="_blank">{{
                s.domain
              }}</a>
              <p>
                <code>{{ s.sourceBranch }} → {{ s.publishBranch }}</code>
              </p>
              <el-button type="primary" plain @click="choose(s, true)"
                >管理文章</el-button
              ><el-button v-if="admin" link type="primary" @click="editSite(s)"
                >编辑配置</el-button
              >
            </article>
          </div></template
        >
        <template v-else-if="page === 'articles'"
          ><div class="heading">
            <div>
              <p class="eyebrow">CONTENT</p>
              <h1>{{ selected?.name || "请选择官网" }} / 文章管理</h1>
              <p>
                管理员可按客户和官网切换管理全部文章；保存已发布文章后，系统会自动创建静态网站发布任务。
              </p>
            </div>
            <div class="article-actions">
              <el-select
                v-if="admin"
                v-model="clientFilter"
                clearable
                placeholder="全部客户"
                @change="switchClient"
                ><el-option
                  v-for="item in clients"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id" /></el-select
              ><el-select
                :model-value="selected?.id"
                placeholder="请选择官网站点"
                :disabled="!selectableSites.length"
                @change="switchSite"
                ><el-option
                  v-for="site in selectableSites"
                  :key="site.id"
                  :label="
                    admin
                      ? `${clientName(site.clientId)} / ${site.name}`
                      : site.name
                  "
                  :value="site.id" /></el-select
              ><el-select
                v-model="statusFilter"
                placeholder="全部状态"
                clearable
                @change="refreshArticles"
                ><el-option label="草稿" value="draft" /><el-option
                  label="已发布"
                  value="published" /><el-option
                  label="已删除"
                  value="deleted" /></el-select
              ><el-button :disabled="!selected" @click="categoryDialog = true"
                >分类管理</el-button
              ><el-button
                type="primary"
                :disabled="!selected"
                :icon="Plus"
                @click="newArticle"
                >新建文章</el-button
              >
            </div>
          </div>
          <el-table :data="articles"
            ><el-table-column label="文章标题" min-width="260"
              ><template #default="{ row }"
                ><b>{{ row.title }}</b
                ><small>/news/{{ row.slug }}/</small></template
              ></el-table-column
            ><el-table-column label="分类" width="120"
              ><template #default="{ row }">{{
                categories.find((c) => c.id === row.categoryId)?.name ||
                "未分类"
              }}</template></el-table-column
            ><el-table-column label="状态" width="110"
              ><template #default="{ row }"
                ><el-tag
                  :type="
                    row.status === 'published'
                      ? 'success'
                      : row.status === 'draft'
                        ? 'info'
                        : 'danger'
                  "
                  >{{
                    row.status === "published"
                      ? "已发布"
                      : row.status === "draft"
                        ? "草稿"
                        : "已删除"
                  }}</el-tag
                ></template
              ></el-table-column
            ><el-table-column label="更新时间" width="180"
              ><template #default="{ row }">{{
                new Date(row.updatedAt).toLocaleString("zh-CN")
              }}</template></el-table-column
            ><el-table-column label="操作" width="160"
              ><template #default="{ row }"
                ><el-button
                  v-if="row.status === 'deleted'"
                  link
                  type="success"
                  @click="restoreArticle(row)"
                  >恢复</el-button
                ><template v-else
                  ><el-button link type="primary" @click="edit(row)"
                    >编辑</el-button
                  ><el-button link type="danger" @click="removeArticle(row)"
                    >删除</el-button
                  ></template
                ></template
              ></el-table-column
            ></el-table
          ></template
        >
        <template v-else-if="page === 'jobs'"
          ><div class="heading">
            <div>
              <p class="eyebrow">DEPLOYMENTS</p>
              <h1>{{ selected?.name || "请选择官网" }} / 发布任务</h1>
              <p>按客户和官网查看对应的构建与 Cloudflare 发布任务。</p>
            </div>
            <div class="article-actions">
              <el-select
                v-if="admin"
                v-model="clientFilter"
                clearable
                placeholder="全部客户"
                @change="switchClient"
                ><el-option
                  v-for="item in clients"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id" /></el-select
              ><el-select
                :model-value="selected?.id"
                placeholder="请选择官网站点"
                :disabled="!selectableSites.length"
                @change="switchSite"
                ><el-option
                  v-for="site in selectableSites"
                  :key="site.id"
                  :label="
                    admin
                      ? `${clientName(site.clientId)} / ${site.name}`
                      : site.name
                  "
                  :value="site.id"
              /></el-select>
            </div>
          </div>
          <el-table :data="jobs"
            ><el-table-column
              prop="id"
              label="任务编号"
              min-width="260" /><el-table-column
              prop="status"
              label="状态"
              width="120" /><el-table-column
              prop="gitCommit"
              label="Git 提交"
              width="190" /><el-table-column
              prop="errorMessage"
              label="错误信息"
              min-width="180" /></el-table
        ></template>
        <template v-else-if="page === 'clients' && admin"
          ><div class="heading">
            <div>
              <p class="eyebrow">CLIENTS</p>
              <h1>客户负责人</h1>
              <p>每个客户公司拥有一个负责人账号，可管理该公司全部官网。</p>
            </div>
            <el-button type="primary" :icon="Plus" @click="clientDialog = true"
              >新增客户</el-button
            >
          </div>
          <el-table :data="clients"
            ><el-table-column
              prop="name"
              label="客户公司"
              min-width="260" /><el-table-column
              prop="contactName"
              label="联系人"
              width="170" /><el-table-column
              prop="contactPhone"
              label="联系电话"
              width="180" /></el-table
        ></template></section></el-container
  ></el-container>
  <el-dialog
    v-model="editor"
    :title="editing ? '编辑文章' : '新建文章'"
    width="960px"
    ><el-form label-position="top"
      ><el-form-item label="文章标题"
        ><el-input v-model="article.title"
      /></el-form-item>
      <div class="grid">
        <el-form-item label="文章分类"
          ><el-select
            v-model="article.category_id"
            clearable
            placeholder="请选择分类"
            ><el-option
              v-for="c in categories"
              :key="c.id"
              :label="c.name"
              :value="c.id" /></el-select></el-form-item
        ><el-form-item label="文章状态"
          ><el-select v-model="article.status"
            ><el-option label="已发布" value="published" /><el-option
              label="草稿"
              value="draft" /></el-select
        ></el-form-item>
      </div>
      <div class="grid">
        <el-form-item label="文章路径 Slug"
          ><el-input
            v-model="article.slug"
            placeholder="留空则由系统自动生成" /></el-form-item
        ><el-form-item label="标签"
          ><el-select
            v-model="article.tags"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入标签后按回车"
        /></el-form-item>
      </div>
      <el-form-item label="封面图片"
        ><div class="cover-row">
          <el-upload
            :auto-upload="false"
            :show-file-list="false"
            accept="image/jpeg,image/png,image/webp,image/gif"
            :on-change="uploadCover"
            ><el-button :loading="busy">上传封面图</el-button></el-upload
          ><el-input
            v-model="article.cover_image_url"
            placeholder="或粘贴封面图片链接"
          /><img
            v-if="article.cover_image_url"
            :src="article.cover_image_url"
            class="cover-preview"
          /></div></el-form-item
      ><el-form-item label="摘要"
        ><el-input
          v-model="article.summary"
          type="textarea"
          :rows="2"
          placeholder="用于列表与搜索摘要" /></el-form-item
      ><el-form-item label="正文内容"
        ><RichEditor v-model="article.content_html" />
        <p class="editor-tip">
          支持标题、字体样式、颜色、列表、链接、图片、视频和表格；正文图片会自动上传到发布中心。
        </p></el-form-item
      ><el-collapse
        ><el-collapse-item title="SEO 优化设置" name="seo"
          ><el-form-item label="SEO 标题"
            ><el-input
              v-model="article.seo_title"
              maxlength="200"
              show-word-limit
              placeholder="留空则使用文章标题" /></el-form-item
          ><el-form-item label="SEO 描述"
            ><el-input
              v-model="article.seo_description"
              type="textarea"
              :rows="3"
              maxlength="500"
              show-word-limit
              placeholder="留空则使用文章摘要" /></el-form-item></el-collapse-item></el-collapse></el-form
    ><template #footer
      ><el-button @click="preview = true">预览</el-button
      ><el-button @click="editor = false">取消</el-button
      ><el-button type="primary" :loading="busy" @click="saveArticle"
        >保存文章</el-button
      ></template
    ></el-dialog
  >
  <el-dialog v-model="preview" title="文章预览" width="820px"
    ><article class="article-preview">
      <img v-if="article.cover_image_url" :src="article.cover_image_url" />
      <p class="eyebrow">
        {{
          categories.find((c) => c.id === article.category_id)?.name || "未分类"
        }}
      </p>
      <h1>{{ article.title || "未填写标题" }}</h1>
      <p>{{ article.summary }}</p>
      <div v-html="article.content_html"></div></article
  ></el-dialog>
  <el-dialog v-model="categoryDialog" title="分类管理" width="480px"
    ><el-input
      v-model="categoryName"
      placeholder="例如：行业资讯"
      @keyup.enter="saveCategory"
      ><template #append
        ><el-button @click="saveCategory">新增</el-button></template
      ></el-input
    >
    <div class="category-list">
      <el-tag
        v-for="c in categories"
        :key="c.id"
        closable
        @close="
          selected &&
          api.removeCategory(selected.id, c.id).then(() => choose(selected!))
        "
        >{{ c.name }}</el-tag
      ><span v-if="!categories.length">暂无分类</span>
    </div></el-dialog
  >
  <el-dialog
    v-model="siteDialog"
    :title="editingSite ? '编辑官网站点配置' : '新增官网站点'"
    width="720px"
    ><el-alert
      :title="
        editingSite
          ? '修改后保留原站点 ID 与 Webhook Key；下一次发布任务会使用新配置。'
          : '创建站点后，系统会生成该网站专属 Webhook Key。请确认 GitHub 仓库已存在，并已关联 Cloudflare Pages 的 publish 分支。'
      "
      type="info"
      :closable="false"
      show-icon
    /><el-form label-position="top" class="site-form"
      ><div class="grid">
        <el-form-item label="所属客户"
          ><el-select
            v-model="siteForm.client_id"
            :disabled="!!editingSite"
            filterable
            placeholder="请选择客户"
            ><el-option
              v-for="item in clients"
              :key="item.id"
              :label="item.name"
              :value="item.id" /></el-select></el-form-item
        ><el-form-item label="官网名称"
          ><el-input
            v-model="siteForm.name"
            placeholder="例如：山东环电机械官网"
        /></el-form-item>
      </div>
      <div class="grid">
        <el-form-item label="正式域名"
          ><el-input
            v-model="siteForm.domain"
            placeholder="例如：www.huandianjixie.com" /></el-form-item
        ><el-form-item label="模板标识"
          ><el-input
            v-model="siteForm.template_key"
            placeholder="例如：huandian"
        /></el-form-item>
      </div>
      <el-form-item label="GitHub 仓库地址"
        ><el-input
          v-model="siteForm.repository_url"
          placeholder="https://github.com/用户名/仓库名.git"
      /></el-form-item>
      <div class="grid">
        <el-form-item label="模板源分支"
          ><el-input
            v-model="siteForm.source_branch"
            placeholder="master" /></el-form-item
        ><el-form-item label="正式发布分支"
          ><el-input v-model="siteForm.publish_branch" placeholder="publish"
        /></el-form-item>
      </div>
      <el-form-item label="模板所在目录"
        ><el-input
          v-model="siteForm.template_root"
          placeholder="根目录填写 .；若模板在 html，填写 html" /></el-form-item
      ><el-form-item label="Cloudflare Pages 项目名（可选）"
        ><el-input
          v-model="siteForm.pages_project_name"
          placeholder="仅用于记录，例如 huandianjixie" /></el-form-item></el-form
    ><template #footer
      ><el-button @click="siteDialog = false">取消</el-button
      ><el-button type="primary" :loading="busy" @click="saveSite">{{
        editingSite ? "保存配置" : "创建站点并生成 Key"
      }}</el-button></template
    ></el-dialog
  >
  <el-dialog v-model="clientDialog" title="新增客户负责人" width="620px"
    ><el-form label-position="top"
      ><div class="grid">
        <el-form-item label="客户公司"
          ><el-input v-model="client.name" /></el-form-item
        ><el-form-item label="负责人姓名"
          ><el-input v-model="client.owner_display_name"
        /></el-form-item>
      </div>
      <div class="grid">
        <el-form-item label="负责人账号"
          ><el-input v-model="client.owner_username" /></el-form-item
        ><el-form-item label="初始密码"
          ><el-input
            v-model="client.owner_password"
            type="password"
            show-password
        /></el-form-item>
      </div>
      <div class="grid">
        <el-form-item label="联系人"
          ><el-input v-model="client.contact_name" /></el-form-item
        ><el-form-item label="联系电话"
          ><el-input v-model="client.contact_phone"
        /></el-form-item></div></el-form
    ><template #footer
      ><el-button @click="clientDialog = false">取消</el-button
      ><el-button type="primary" @click="saveClient"
        >创建客户</el-button
      ></template
    ></el-dialog
  >
</template>

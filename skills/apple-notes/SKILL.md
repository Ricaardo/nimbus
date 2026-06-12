---
name: apple-notes
description: 使用 `memo` CLI 在 macOS 终端管理 Apple Notes
---

## 需求

- **操作系统：** macOS
- **必需工具：** `memo`
- **依赖：** Apple Notes.app 必须可访问

## 安装

### Homebrew（推荐）
```bash
brew tap antoniorodr/memo/memo
brew install antoniorodr/memo/memo
```

### 手动（pip）
```bash
pip install .
```

**注意：** 授予 Automation 访问 Notes.app 的权限（系统设置 > 隐私与安全 > 自动化）

## 可用命令

### 查看笔记
| 命令 | 描述 |
|------|------|
| `memo notes` | 列出所有笔记 |
| `memo notes -f "Folder Name"` | 按文件夹筛选 |
| `memo notes -s "query"` | 模糊搜索笔记 |

### 创建笔记
| 命令 | 描述 |
|------|------|
| `memo notes -a` | 交互式编辑器创建新笔记 |
| `memo notes -a "Note Title"` | 快速添加标题 |

### 编辑笔记
| 命令 | 描述 |
|------|------|
| `memo notes -e` | 编辑现有笔记（交互式选择）|

### 删除笔记
| 命令 | 描述 |
|------|------|
| `memo notes -d` | 删除笔记（交互式选择）|

### 移动笔记
| 命令 | 描述 |
|------|------|
| `memo notes -m` | 移动笔记到不同文件夹 |

### 导出笔记
| 命令 | 描述 |
|------|------|
| `memo notes -ex` | 导出为 HTML/Markdown |

## 限制

- 无法编辑包含图片或附件的笔记
- 交互式提示可能需要终端访问

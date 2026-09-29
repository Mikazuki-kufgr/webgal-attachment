# OPPOSans来源边界

本地构建使用宿主原有的 OPPOSans R 1.00。该字体不是 MPL/OFL 字体；ColorOS 官方页面包含免费使用说明，也限制另行提供下载渠道：https://www.coloros.com/article/A00000050/ 。不把免费使用解释为本项目可再分发字体文件。

安装包及源码包均不携带字体二进制或其压缩副本。制作器只读引用宿主已有字体，不要求哈希匹配、不复制到受管目录；缺失时使用浏览器后备字体。源码精确复现前可执行 `node build-tools/prepare-host-font.mjs <原宿主字体绝对路径>`，仅构建输入核验 SHA-256：EA92535935F8B5DA18B64BB23E5FFBFEF1417B7AE4FF3FC15372A65EE95A9580。不联网下载，不修改用户宿主字体。

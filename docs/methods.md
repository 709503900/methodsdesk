# 方法依据与验算

功效分析适用于等方差且等额分组的独立样本 t 检验，以及对配对差值的配对 t 检验。网站在给定效应量和显著性水平下求达到目标功效的最小整数样本量。给定样本量时，可按同一模型计算所设效应量下的预期功效。双侧功效计入两端拒绝域。使用 [Faul 等，2007](https://doi.org/10.3758/BF03193146) 的检验定义和 [R 的非中心 t 分布](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/TDist.html) 核对。数值积分采用 [NIST DLMF 的高斯求积方法](https://dlmf.nist.gov/3.5)。验算包括独立样本和配对样本的单侧与双侧、极小显著性水平、大样本和最小样本取整。采用双侧、显著性水平 0.05、效应量 0.5 和目标功效 0.80 时，独立样本需要每组 64 人，配对样本需要 34 对。

问卷样本量采用总体比例的正态近似规划公式与有限总体修正。方程及抽样设计参考 [Penn State 抽样理论](https://online.stat.psu.edu/stat506/Lesson02) 和 [OpenEpi 比例规划技术说明](https://openepi.com/PDFDocs/SSProporDoc.pdf)。问卷发放量是根据预期回收率和回收问卷中的可用率计算的招募预算，参考 [WHO STEPS 抽样工具](https://www.who.int/teams/noncommunicable-diseases/surveillance/systems-tools/steps/planning-sampling)。大总体、95% 置信、预计比例 50% 和误差 5 个百分点时向上取整得到 385 份。总体为 1,000 人时得到 278 份。以 385 份为目标，预计回收 60%，其中 90% 可用，发放量为 713 个邀请。可在同一目标和邀请上限下比较两组回收率及可用率，并记录邀请对象容量是否足够。

访谈规划根据 [Malterud 等，2016](https://doi.org/10.1177/1049732315617444) 组织研究者填写的信息力论证。编码饱和度采用 [Guest 等，2020](https://doi.org/10.1371/journal.pone.0232076) 固定基准和滚动窗口的定义。基准 4 次、窗口 2 次时，论文图 3 在 5% 阈值下的首次结果为 6+2，在 0% 下为 10+2。反思性主题分析的适用边界参考 [Braun 与 Clarke，2021](https://uwe-repository.worktribe.com/output/4820803)。

港澳出入境时长沿用 LeeV李威原工具的记录配对和逐日扣除规则。自然离境天数包含离境和返境日。可按自然年或澳城大学年汇总。公众假期覆盖 2021 至 2027 年。2027 年 8 月 23 日为暂定学年界线，输出标明相关日期和覆盖情况。 [澳门城市大学校历](https://www.cityu.edu.mo/zh/%E5%A4%A7%E5%AD%B8%E6%A0%A1%E6%9B%86-2/) · [澳门公众假期](https://www.gov.mo/zh-hant/public-holidays/) · [香港公众假期](https://www.gov.hk/tc/about/abouthk/holiday/)

文件痕迹检查参考 watermarks-remover 的检测用途，按浏览器可读取的格式分别报告证据。纯文本和指定的 Office 部件列出字符位置，PDF 读取应用元数据，PNG、JPEG 和 WebP 检查标准来源字段与嵌入式 C2PA 结构。C2PA 容器发现与签名验证是两项检查。此网页的结果无法判定图像像素水印、文本统计水印或作者身份。 [watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover) · [Unicode](https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-23/) · [ECMA-376](https://ecma-international.org/publications-and-standards/standards/ecma-376/) · [C2PA](https://spec.c2pa.org/specifications/specifications/2.5/specs/C2PA_Specification.html) · [IPTC](https://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2025.1.html)

可运行 `node --test tests/*.test.mjs`。功效模块另与 R 4.6.0 对照 5,728 组固定样本量设定，观测到的最大绝对功效差约 3 × 10⁻¹⁰。这组对照覆盖本版支持的两种设计、两种检验方向和多种样本量。

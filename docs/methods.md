# 方法依据与验算

功效分析适用于等方差且等额分组的独立样本 t 检验，以及对配对差值的配对 t 检验。网站在给定效应量和显著性水平下求达到目标功效的最小整数样本量。双侧功效计入两端拒绝域。使用 [Faul 等，2007](https://doi.org/10.3758/BF03193146) 的检验定义和 [R 的非中心 t 分布](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/TDist.html) 核对。数值积分采用 [NIST DLMF 的高斯求积方法](https://dlmf.nist.gov/3.5)。验算包括独立样本和配对样本的单侧与双侧、极小显著性水平、大样本和最小样本取整。采用双侧、显著性水平 0.05、效应量 0.5 和目标功效 0.80 时，独立样本需要每组 64 人，配对样本需要 34 对。

问卷样本量采用总体比例的正态近似规划公式与有限总体修正。方程及抽样设计参考 [Penn State 抽样理论](https://online.stat.psu.edu/stat506/Lesson02) 和 [OpenEpi 比例规划技术说明](https://openepi.com/PDFDocs/SSProporDoc.pdf)。问卷发放量是根据预期回收率和回收问卷中的可用率计算的招募预算，参考 [WHO STEPS 抽样工具](https://www.who.int/teams/noncommunicable-diseases/surveillance/systems-tools/steps/planning-sampling)。大总体、95% 置信、预计比例 50% 和误差 5 个百分点时向上取整得到 385 份。总体为 1,000 人时得到 278 份。以 385 份为目标，预计回收 60%，其中 90% 可用，发放量为 713 个邀请。

访谈规划根据 [Malterud 等，2016](https://doi.org/10.1177/1049732315617444) 组织研究者填写的信息力论证。编码饱和度采用 [Guest 等，2020](https://doi.org/10.1371/journal.pone.0232076) 固定基准和滚动窗口的定义。基准 4 次、窗口 2 次时，论文图 3 在 5% 阈值下的首次结果为 6+2，在 0% 下为 10+2。反思性主题分析的适用边界参考 [Braun 与 Clarke，2021](https://uwe-repository.worktribe.com/output/4820803)。

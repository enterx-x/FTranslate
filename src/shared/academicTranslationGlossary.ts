export const ACADEMIC_TRANSLATION_GLOSSARY_VERSION = 'academic-en-zh-v3';

interface AcademicGlossaryEntry {
  id: string;
  target: string;
  sources: readonly string[];
}

export interface AcademicGlossaryMatch {
  id: string;
  start: number;
  end: number;
  source: string;
  target: string;
}

// This is deliberately a terminology table, not a sentence-rewrite list.
// Longer phrases are selected before their component words so the glossary can
// constrain domain meaning without trying to rewrite the model's grammar.
const ACADEMIC_GLOSSARY: readonly AcademicGlossaryEntry[] = [
  {
    id: 'proprioceptive-visual-correspondence',
    target: '本体感知-视觉对应关系',
    sources: ['proprioceptive-visual correspondence', 'proprioceptive visual correspondence']
  },
  {
    id: 'physics-informed-neural-network',
    target: '物理信息神经网络',
    sources: ['physics-informed neural networks', 'physics-informed neural network']
  },
  {
    id: 'model-predictive-control',
    target: '模型预测控制',
    sources: ['model predictive control']
  },
  {
    id: 'control-barrier-function',
    target: '控制屏障函数',
    sources: ['control barrier functions', 'control barrier function']
  },
  {
    id: 'ordinary-differential-equation',
    target: '常微分方程',
    sources: ['ordinary differential equations', 'ordinary differential equation']
  },
  {
    id: 'partial-differential-equation',
    target: '偏微分方程',
    sources: ['partial differential equations', 'partial differential equation']
  },
  {
    id: 'deep-reinforcement-learning',
    target: '深度强化学习',
    sources: ['deep reinforcement learning']
  },
  {
    id: 'offline-reinforcement-learning',
    target: '离线强化学习',
    sources: ['offline reinforcement learning']
  },
  {
    id: 'on-policy-reinforcement-learning',
    target: '同策略强化学习',
    sources: ['on-policy reinforcement learning', 'on policy reinforcement learning']
  },
  {
    id: 'off-policy-reinforcement-learning',
    target: '离策略强化学习',
    sources: ['off-policy reinforcement learning', 'off policy reinforcement learning']
  },
  {
    id: 'reinforcement-learning',
    target: '强化学习',
    sources: ['reinforcement learning']
  },
  {
    id: 'vision-language-action-model',
    target: '视觉-语言-动作模型',
    sources: ['vision-language-action models', 'vision-language-action model']
  },
  {
    id: 'vision-language-model',
    target: '视觉语言模型',
    sources: ['vision-language models', 'vision-language model']
  },
  {
    id: 'human-robot-interaction',
    target: '人机交互',
    sources: ['human-robot interaction']
  },
  {
    id: 'humanoid-motion-tracking',
    target: '人形机器人运动跟踪',
    sources: ['humanoid motion tracking']
  },
  {
    id: 'humanoid-robot',
    target: '人形机器人',
    sources: ['humanoid robots', 'humanoid robot']
  },
  {
    id: 'humanoid-object-interaction',
    target: '人形机器人-物体交互',
    sources: ['humanoid-object interaction', 'humanoid object interaction']
  },
  {
    id: 'whole-body-manipulation',
    target: '全身操作',
    sources: ['whole-body manipulation', 'whole body manipulation']
  },
  {
    id: 'dexterous-manipulation',
    target: '灵巧操作',
    sources: ['dexterous manipulation']
  },
  {
    id: 'diffusion-policy',
    target: '扩散策略',
    sources: ['diffusion policies', 'diffusion policy']
  },
  {
    id: 'diffusion-model',
    target: '扩散模型',
    sources: ['diffusion models', 'diffusion model']
  },
  {
    id: 'ablation-study',
    target: '消融实验',
    sources: ['ablation studies', 'ablation study']
  },
  {
    id: 'kl-divergence',
    target: 'KL 散度',
    sources: ['KL-divergence', 'KL divergence']
  },
  {
    id: 'fall-recovery',
    target: '跌倒恢复',
    sources: ['fall-recovery', 'fall recovery']
  },
  {
    id: 'locomotion-tracking',
    target: '运动跟踪',
    sources: ['locomotion tracking']
  },
  {
    id: 'motion-tracking',
    target: '运动跟踪',
    sources: ['motion tracking']
  },
  {
    id: 'motion-planning',
    target: '运动规划',
    sources: ['motion planning']
  },
  {
    id: 'path-planning',
    target: '路径规划',
    sources: ['path planning']
  },
  {
    id: 'tactile-sensing',
    target: '触觉感知',
    sources: ['tactile sensing']
  },
  {
    id: 'haptic-feedback',
    target: '触觉反馈',
    sources: ['haptic feedback']
  },
  {
    id: 'contact-force',
    target: '接触力',
    sources: ['contact forces', 'contact force']
  },
  {
    id: 'force-regulation',
    target: '力调节',
    sources: ['force regulation']
  },
  {
    id: 'force-control',
    target: '力控制',
    sources: ['force control']
  },
  {
    id: 'force-feedback',
    target: '力反馈',
    sources: ['force feedback']
  },
  {
    id: 'force-sensor',
    target: '力传感器',
    sources: ['force sensors', 'force sensor']
  },
  {
    id: 'end-effector',
    target: '末端执行器',
    sources: ['end-effectors', 'end-effector', 'end effectors', 'end effector']
  },
  {
    id: 'articulated-object',
    target: '关节式物体',
    sources: ['articulated objects', 'articulated object']
  },
  {
    id: 'self-other-distinction',
    target: '自我-他者区分',
    sources: ['self-other distinction', 'self other distinction']
  },
  {
    id: 'system-identification',
    target: '系统辨识',
    sources: ['system identification']
  },
  {
    id: 'sample-efficiency',
    target: '样本效率',
    sources: ['sample efficiency']
  },
  {
    id: 'reward-shaping',
    target: '奖励塑形',
    sources: ['reward shaping']
  },
  {
    id: 'reward-model',
    target: '奖励模型',
    sources: ['reward models', 'reward model']
  },
  {
    id: 'world-model',
    target: '世界模型',
    sources: ['world models', 'world model']
  },
  {
    id: 'foundation-model',
    target: '基础模型',
    sources: ['foundation models', 'foundation model']
  },
  {
    id: 'imitation-learning',
    target: '模仿学习',
    sources: ['imitation learning']
  },
  {
    id: 'policy-gradient',
    target: '策略梯度',
    sources: ['policy gradients', 'policy gradient']
  },
  {
    id: 'actor-critic',
    target: 'Actor-Critic',
    sources: ['actor-critic', 'actor critic']
  },
  {
    id: 'trust-region',
    target: '信赖域',
    sources: ['trust-region', 'trust region']
  },
  {
    id: 'massively-parallel',
    target: '大规模并行',
    sources: ['massively parallel']
  },
  {
    id: 'on-policy',
    target: '同策略',
    sources: ['on-policy', 'on policy']
  },
  {
    id: 'off-policy',
    target: '离策略',
    sources: ['off-policy', 'off policy']
  },
  {
    id: 'sim-to-real',
    target: '仿真到现实',
    sources: ['sim-to-real', 'sim to real']
  },
  {
    id: 'zero-shot',
    target: '零样本',
    sources: ['zero-shot', 'zero shot']
  },
  {
    id: 'few-shot',
    target: '少样本',
    sources: ['few-shot', 'few shot']
  },
  {
    id: 'state-of-the-art',
    target: '最先进',
    sources: ['state-of-the-art', 'state of the art']
  },
  {
    id: 'unitree-g1',
    target: '宇树 G1',
    sources: ['Unitree G1']
  },
  {
    id: 'humanoid',
    target: '人形机器人',
    sources: ['humanoids', 'humanoid']
  },
  {
    id: 'proprioception',
    target: '本体感知',
    sources: ['proprioceptive', 'proprioception']
  },
  {
    id: 'generalization',
    target: '泛化',
    sources: ['generalizable', 'generalization']
  },
  {
    id: 'robustness',
    target: '鲁棒性',
    sources: ['robustness']
  },
  {
    id: 'training',
    target: '训练',
    sources: ['training']
  },
  {
    id: 'policy',
    target: '策略',
    sources: ['policies', 'policy']
  }
] as const;

export function collectAcademicGlossaryMatches(source: string): AcademicGlossaryMatch[] {
  if (!source) {
    return [];
  }

  const sourceLower = source.toLowerCase();
  const candidates: AcademicGlossaryMatch[] = [];
  ACADEMIC_GLOSSARY.forEach((entry) => {
    entry.sources.forEach((variant) => {
      const variantLower = variant.toLowerCase();
      let fromIndex = 0;
      while (fromIndex < source.length) {
        const start = sourceLower.indexOf(variantLower, fromIndex);
        if (start < 0) {
          break;
        }
        const end = start + variant.length;
        if (hasAsciiWordBoundaries(source, start, end, variant)) {
          candidates.push({
            id: entry.id,
            start,
            end,
            source: source.slice(start, end),
            target: entry.target
          });
        }
        fromIndex = Math.max(start + 1, end);
      }
    });
  });

  candidates.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start) ||
      left.id.localeCompare(right.id)
  );

  const selected: AcademicGlossaryMatch[] = [];
  let coveredUntil = -1;
  candidates.forEach((candidate) => {
    if (candidate.start < coveredUntil) {
      return;
    }
    selected.push(candidate);
    coveredUntil = candidate.end;
  });
  return selected;
}

function hasAsciiWordBoundaries(source: string, start: number, end: number, variant: string): boolean {
  const first = variant[0] ?? '';
  const last = variant[variant.length - 1] ?? '';
  const previous = start > 0 ? source[start - 1] ?? '' : '';
  const next = end < source.length ? source[end] ?? '' : '';
  const needsLeadingBoundary = isAsciiWordCharacter(first);
  const needsTrailingBoundary = isAsciiWordCharacter(last);
  return (
    (!needsLeadingBoundary || !isAsciiWordCharacter(previous)) &&
    (!needsTrailingBoundary || !isAsciiWordCharacter(next))
  );
}

function isAsciiWordCharacter(value: string): boolean {
  return /[A-Za-z0-9_]/u.test(value);
}

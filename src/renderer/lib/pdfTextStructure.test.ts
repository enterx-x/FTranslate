import { describe, expect, it } from 'vitest';
import {
  buildPdfDocumentOutline,
  buildPdfPageOutline,
  orderPositionedTextItemsForReading,
  type PositionedPdfTextItem
} from './pdfTextStructure';

function item(str: string, x: number, y: number, width = 120, height = 10): PositionedPdfTextItem {
  return { str, x, y, width, height, page: 1 };
}

describe('PDF text structure extraction', () => {
  it('rebuilds reading order for two-column academic pages', () => {
    const outline = buildPdfPageOutline(1, [
      item('right column later', 330, 120),
      item('left column first', 60, 120),
      item('left column second', 60, 140),
      item('right column final', 330, 140)
    ]);

    expect(outline.map((block) => block.original)).toEqual([
      'left column first left column second',
      'right column later right column final'
    ]);
  });

  it('classifies headings, formulas, captions, and paragraphs', () => {
    const outline = buildPdfPageOutline(2, [
      item('I. INTRODUCTION', 180, 80, 160, 14),
      item('x_t = f(x, u) + epsilon', 80, 130, 180, 10),
      item('Fig. 1: Robot examples.', 80, 170, 180, 9),
      item('Foundation models work on the principle that generalist capabilities emerge.', 80, 220)
    ]);

    expect(outline.map((block) => block.type)).toEqual([
      'heading',
      'formula',
      'caption',
      'paragraph'
    ]);
    expect(outline[0].section).toBe('I. INTRODUCTION');
    expect(outline.every((block) => block.page === 2)).toBe(true);
    expect(outline.every((block) => block.sourceHash)).toBe(true);
  });

  it('normalizes letter-spaced section headings extracted from PDFs', () => {
    const outline = buildPdfPageOutline(2, [
      item('I. I NTRODUCTION', 180, 80, 160, 14),
      item('Foundation models work on the principle that generalist capabilities emerge.', 80, 130),
      item('II. R ELATED W ORK', 180, 180, 160, 14),
      item('Generalist robot manipulation policies are widely studied.', 80, 230)
    ]);

    expect(outline.map((block) => block.section)).toEqual([
      'I. INTRODUCTION',
      'I. INTRODUCTION',
      'II. RELATED WORK',
      'II. RELATED WORK'
    ]);
  });

  it('adds stable section grouping metadata for headings and natural paragraphs', () => {
    const outline = buildPdfDocumentOutline([
      {
        page: 1,
        items: [
          item('Abstract', 220, 80, 120, 14),
          item('We present a model that follows diverse language instructions.', 70, 120, 260, 10),
          item('I. INTRODUCTION', 220, 180, 160, 14),
          item('Foundation models emerge from large and diverse datasets.', 70, 220, 260, 10),
          item('A. Subgoal images', 70, 280, 150, 12),
          item('Subgoal images provide additional context for robot policies.', 70, 320, 260, 10)
        ]
      }
    ]);

    const paragraphs = outline.filter((block) => block.type === 'paragraph');

    expect(outline.map((block) => block.section)).toEqual([
      'Abstract',
      'Abstract',
      'I. INTRODUCTION',
      'I. INTRODUCTION',
      'A. Subgoal images',
      'A. Subgoal images'
    ]);
    expect(paragraphs.map((block) => block.sectionOrder)).toEqual([1, 2, 3]);
    expect(paragraphs.map((block) => block.paragraphOrder)).toEqual([1, 1, 1]);
    expect(new Set(paragraphs.map((block) => block.sectionId)).size).toBe(3);
  });

  it('joins hyphenated line breaks within one paragraph', () => {
    const outline = buildPdfPageOutline(3, [
      item('Cross-embodiment generaliza-', 60, 100),
      item('tion is important for robot learning.', 60, 113)
    ]);

    expect(outline[0].original).toBe(
      'Cross-embodiment generalization is important for robot learning.'
    );
  });

  it('cleans PDF item spacing around model version tokens', () => {
    const outline = buildPdfPageOutline(2, [
      item('The model', 60, 100, 55, 10),
      item('π', 120, 100, 5, 10),
      item('0', 127, 100, 4, 6),
      item('.', 132, 100, 2, 6),
      item('7', 136, 100, 4, 6),
      item('can follow diverse language instructions.', 146, 100, 220, 10)
    ]);

    expect(outline[0].original).toBe('The model π0.7 can follow diverse language instructions.');
  });

  it('keeps zoomed body lines from the same paragraph as one candidate block', () => {
    const outline = buildPdfPageOutline(4, [
      item('Foundation models work on the principle that generalist capabilities', 60, 100, 280, 22),
      item('emerge from training on large and diverse datasets and then', 60, 132, 280, 22),
      item('transfer to many downstream robotic manipulation tasks.', 60, 164, 280, 22)
    ]);

    expect(outline).toHaveLength(1);
    expect(outline[0].original).toBe(
      'Foundation models work on the principle that generalist capabilities emerge from training on large and diverse datasets and then transfer to many downstream robotic manipulation tasks.'
    );
  });

  it('splits natural paragraphs when a new indented line follows a sentence boundary', () => {
    const outline = buildPdfPageOutline(2, [
      item('I. INTRODUCTION', 220, 80, 160, 14),
      item('Foundation models work on the principle that generalist capabilities', 58.9, 120, 260, 10),
      item('emerge from training on large and diverse datasets.', 49, 134, 260, 10),
      item('In this paper, we present a new model with compositional generalization.', 58.9, 148, 260, 10),
      item('This model follows diverse instructions in unseen environments.', 49, 162, 260, 10)
    ]);

    expect(outline.filter((block) => block.type === 'paragraph').map((block) => block.original)).toEqual([
      'Foundation models work on the principle that generalist capabilities emerge from training on large and diverse datasets.',
      'In this paper, we present a new model with compositional generalization. This model follows diverse instructions in unseen environments.'
    ]);
  });

  it('does not merge body lines across columns', () => {
    const outline = buildPdfPageOutline(5, [
      item('Left column paragraph starts with enough academic content', 60, 100, 220, 12),
      item('and finishes this sentence in the left column.', 60, 118, 220, 12),
      item('Right column paragraph starts independently with enough content', 330, 100, 220, 12),
      item('and finishes this separate sentence in the right column.', 330, 118, 220, 12)
    ]);

    expect(outline.map((block) => block.original)).toEqual([
      'Left column paragraph starts with enough academic content and finishes this sentence in the left column.',
      'Right column paragraph starts independently with enough content and finishes this separate sentence in the right column.'
    ]);
  });

  it('filters front matter, author lists, and figure labels from AI extraction', () => {
    const outline = buildPdfPageOutline(1, [
      item('π0.7: a Steerable Generalist Robotic Foundation', 120, 40, 360, 18),
      item('Model with Emergent Capabilities', 160, 62, 320, 18),
      item('Bo Ai, Ali Amin, Richelle Aniceto, Ashwin Balakrishna, Greg Balke, Kevin Black', 90, 94, 460, 8),
      item('Robot Data pick up the knife chop the zucchini Demonstration Data close the microwave', 80, 190, 420, 8),
      item('Abstract—We present a new robotic foundation model, called π0.7, that can enable', 70, 520, 220, 9),
      item('strong out-of-the-box performance in a wide range of scenarios.', 70, 533, 220, 9)
    ]);

    expect(outline).toHaveLength(1);
    expect(outline[0]).toMatchObject({
      section: 'Abstract',
      type: 'paragraph'
    });
    expect(outline[0].original).toBe(
      'We present a new robotic foundation model, called π0.7, that can enable strong out-of-the-box performance in a wide range of scenarios.'
    );
  });

  it('filters arXiv sidebars, page chrome, and title-case figure labels', () => {
    const outline = buildPdfPageOutline(1, [
      item('1', 300, 18, 8, 8),
      item('arXiv:2604.15483v2 [cs.LG] 24 Apr 2026', 12, 300, 16, 220),
      item('Language Instructions Subgoal Images Episode Metadata', 180, 260, 260, 8),
      item('Desired Metadata World Model High-Level Policy', 250, 320, 260, 8),
      item('Foundation models work on the principle that generalist capabilities emerge', 70, 560, 260, 10),
      item('from training on large and diverse datasets.', 70, 574, 260, 10),
      item('2', 310, 820, 8, 8)
    ]);

    expect(outline.map((block) => block.original)).toEqual([
      'Foundation models work on the principle that generalist capabilities emerge from training on large and diverse datasets.'
    ]);
  });

  it('filters multi-line author lists before the abstract', () => {
    const outline = buildPdfPageOutline(1, [
      item('Physical Intelligence', 250, 80, 160, 14),
      item('Bo Ai, Ali Amin, Richelle Aniceto, Ashwin Balakrishna, Greg Balke, K. Black,', 80, 112, 460, 8),
      item('George Bokinsky, Shihao Cao, T. Charbonnier, Vedant Choudhary, Foster Collins,', 80, 124, 460, 8),
      item('Ken Conley, Grace Connors, James Darpinian, Karan Dhabalia, Maitrayee Dhaka.', 80, 136, 460, 8),
      item('Abstract—We present a new robotic foundation model, called π0.7, that can enable', 70, 520, 260, 9),
      item('strong out-of-the-box performance in a wide range of scenarios.', 70, 533, 260, 9)
    ]);

    expect(outline).toHaveLength(1);
    expect(outline[0]).toMatchObject({
      section: 'Abstract',
      type: 'paragraph'
    });
    expect(outline[0].original).not.toContain('Bo Ai');
  });

  it('keeps natural paragraphs but rejects short flowchart labels from the AI queue', () => {
    const outline = buildPdfPageOutline(4, [
      item('World Model', 250, 120, 80, 8),
      item('action expert', 340, 120, 80, 8),
      item('We consider multi-view subgoals g_t = (G_t,1, ..., G_t,k),', 70, 380, 260, 10),
      item('which are effective at conveying task-level intent for policies.', 70, 394, 260, 10)
    ]);

    expect(outline).toHaveLength(1);
    expect(outline[0].original).toBe(
      'We consider multi-view subgoals g_t = (G_t,1, ..., G_t,k), which are effective at conveying task-level intent for policies.'
    );
  });

  it('filters long figure action-label text without sentence punctuation', () => {
    const outline = buildPdfPageOutline(1, [
      item('Demonstration Data close the microwave open the upper left cabi put', 80, 260, 260, 8),
      item('the ketchup in teh fridge pick up the mitten case to the left load', 80, 274, 260, 8),
      item('the lower rack sharpie throw away the silver spoon', 80, 288, 260, 8),
      item('Abstract—We present a new robotic foundation model, called π0.7, that can enable', 70, 520, 260, 9),
      item('strong out-of-the-box performance in a wide range of scenarios.', 70, 533, 260, 9)
    ]);

    expect(outline.map((block) => block.original)).toEqual([
      'We present a new robotic foundation model, called π0.7, that can enable strong out-of-the-box performance in a wide range of scenarios.'
    ]);
  });

  it('filters page-one figure caption fragments before the abstract', () => {
    const outline = buildPdfPageOutline(1, [
      item('INFERENCE', 80, 360, 100, 8),
      item('trained with diverse prompts that contain not only the task', 80, 380, 260, 8),
      item('description, but detailed language, generated subgoal images, and episode metadata.', 80, 394, 260, 8),
      item('Abstract—We present a new robotic foundation model, called π0.7, that can enable', 70, 620, 260, 9),
      item('strong out-of-the-box performance in a wide range of scenarios.', 70, 633, 260, 9)
    ]);

    expect(outline).toHaveLength(1);
    expect(outline[0]).toMatchObject({
      section: 'Abstract',
      original:
        'We present a new robotic foundation model, called π0.7, that can enable strong out-of-the-box performance in a wide range of scenarios.'
    });
  });

  it('merges lowercase paragraph continuations across PDF page boundaries', () => {
    const outline = buildPdfDocumentOutline([
      {
        page: 1,
        items: [
          item('Abstract—We present a new robotic foundation model that can use diverse context', 70, 700, 280, 9),
          item('conditioning information during training,', 70, 713, 280, 9)
        ]
      },
      {
        page: 2,
        items: [
          item('including demonstrations, failures, and data from non-robot sources.', 70, 40, 280, 9),
          item('I. INTRODUCTION', 220, 110, 160, 14),
          item('Foundation models work on the principle that generalist capabilities emerge.', 70, 150, 280, 9)
        ]
      }
    ]);

    const paragraphs = outline.filter((block) => block.type === 'paragraph');
    expect(paragraphs.map((block) => ({ section: block.section, original: block.original }))).toEqual([
      {
        section: 'Abstract',
        original:
          'We present a new robotic foundation model that can use diverse context conditioning information during training, including demonstrations, failures, and data from non-robot sources.'
      },
      {
        section: 'I. INTRODUCTION',
        original: 'Foundation models work on the principle that generalist capabilities emerge.'
      }
    ]);
  });

  it('keeps uppercase cross-page paragraphs separate to avoid accidental merges', () => {
    const outline = buildPdfDocumentOutline([
      {
        page: 8,
        items: [item('The model learns from diverse datasets and improves downstream performance.', 70, 700, 280, 9)]
      },
      {
        page: 9,
        items: [item('This section evaluates the model on held-out tasks.', 70, 40, 280, 9)]
      }
    ]);

    expect(outline.filter((block) => block.type === 'paragraph')).toHaveLength(2);
  });

  it('merges same-section column continuations before cross-page continuations', () => {
    const outline = buildPdfDocumentOutline([
      {
        page: 1,
        items: [
          item('Abstract—We present a model that matches much more specialized', 49, 620, 251, 9),
          item('RL-finetuned models. The main idea is to use diverse data,', 312, 620, 260, 9)
        ]
      },
      {
        page: 2,
        items: [
          item('including demonstrations, failures, and data from non-robot sources.', 49, 40, 260, 9)
        ]
      }
    ]);

    const paragraphs = outline.filter((block) => block.type === 'paragraph');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]).toMatchObject({
      section: 'Abstract',
      original:
        'We present a model that matches much more specialized RL-finetuned models. The main idea is to use diverse data, including demonstrations, failures, and data from non-robot sources.'
    });
  });

  it('filters short epigraph quotes before the first body paragraph', () => {
    const outline = buildPdfPageOutline(2, [
      item('I. INTRODUCTION', 220, 100, 160, 14),
      item('I am a part of all that I have met.', 150, 130, 220, 9),
      item('Alfred, Lord Tennyson, Ulysses', 160, 142, 180, 8),
      item('Foundation models work on the principle that generalist capabilities emerge from training.', 70, 154, 280, 9)
    ]);

    expect(outline.filter((block) => block.type === 'paragraph').map((block) => block.original)).toEqual([
      'Foundation models work on the principle that generalist capabilities emerge from training.'
    ]);
  });

  it('does not merge epigraph attribution with nearby right-column body text', () => {
    const outline = buildPdfPageOutline(2, [
      item('I. INTRODUCTION', 220, 100, 160, 14),
      item('Alfred, Lord Tennyson,', 183.3, 638.4, 86.2, 9),
      item('Ulysses', 272.6, 638.4, 27.4, 9),
      item('proficiency might be more subtle (e.g., information about the', 312, 642.4, 251, 10),
      item('overall quality of the episode), or might simply be hard to express with language alone.', 312, 656.4, 251, 10)
    ]);

    expect(outline.filter((block) => block.type === 'paragraph').map((block) => block.original)).toEqual([
      'proficiency might be more subtle (e.g., information about the overall quality of the episode), or might simply be hard to express with language alone.'
    ]);
  });

  it('does not merge adjacent wide text runs from different columns', () => {
    const outline = buildPdfPageOutline(2, [
      item('I. INTRODUCTION', 220, 80, 160, 14),
      item('Foundation models work on the principle that generalist', 58.9, 120, 241.1, 10),
      item('express with language alone (e.g., the particular appearance of', 312, 120.3, 251.1, 10),
      item('capabilities emerge from training on large and diverse datasets.', 49, 134, 251.1, 10)
    ]);

    const paragraphs = outline.filter((block) => block.type === 'paragraph');
    expect(paragraphs[0].original).toBe(
      'Foundation models work on the principle that generalist capabilities emerge from training on large and diverse datasets.'
    );
    expect(paragraphs[0].original).not.toContain('express with language alone');
  });

  it('does not merge abstract text with the opposite column when the gap is narrow', () => {
    const outline = buildPdfPageOutline(1, [
      item('Abstract', 58.9, 152.2, 30.9, 9),
      item('—We present a new robotic foundation model, called', 89.8, 152.2, 210.2, 9),
      item('RL-finetuned', 312, 152.2, 51.3, 9),
      item('π0.7, that can enable strong out-of-the-box performance in a wide range of scenarios.', 58.9, 166.2, 260, 9)
    ]);

    const paragraphs = outline.filter((block) => block.type === 'paragraph');
    expect(paragraphs[0].section).toBe('Abstract');
    expect(paragraphs[0].original).toBe(
      'We present a new robotic foundation model, called π0.7, that can enable strong out-of-the-box performance in a wide range of scenarios.'
    );
    expect(paragraphs[0].original).not.toContain('RL-finetuned');
  });

  it('keeps multi-line abstract columns as separate paragraph candidates', () => {
    const outline = buildPdfPageOutline(1, [
      item('Abstract', 58.9, 100, 30.9, 9),
      item('—We present a new robotic foundation model, called', 89.8, 100, 210.2, 9),
      item('RL-finetuned models. The main idea behind π0.7 is to use', 312, 100, 251.1, 9),
      item('π0.7, that can enable strong out-of-the-box performance in a wide', 49, 114, 251.1, 9),
      item('diverse context conditioning during training. This conditioning', 312, 114, 251.1, 9),
      item('range of scenarios. π0.7 can follow diverse language instructions', 49, 128, 251.1, 9),
      item('that describes what it should do, but on additional multimodal', 312, 128, 251.1, 9)
    ]);

    const paragraphs = outline.filter((block) => block.type === 'paragraph');
    expect(paragraphs[0].original).toBe(
      'We present a new robotic foundation model, called π0.7, that can enable strong out-of-the-box performance in a wide range of scenarios. π0.7 can follow diverse language instructions'
    );
    expect(paragraphs[0].original).not.toContain('RL-finetuned');
    expect(paragraphs[0].original).not.toContain('that describes what it should do');
  });

  it('splits columns after a left-column line made of many small word items', () => {
    const outline = buildPdfPageOutline(1, [
      item('Abstract', 58.9, 100, 30.9, 9),
      item('—We present a new robotic foundation model.', 89.8, 100, 210.2, 9),
      item('such', 49, 114, 17.4, 9),
      item('as', 72.6, 114, 8, 9),
      item('operating', 86.8, 114, 36.9, 9),
      item('an', 129.8, 114, 9.5, 9),
      item('espresso', 145.5, 114, 31.7, 9),
      item('machine', 183.4, 114, 32.4, 9),
      item('out', 221.9, 114, 12.5, 9),
      item('of', 240.6, 114, 7.5, 9),
      item('the', 254.3, 114, 12, 9),
      item('box', 272.4, 114, 14, 9),
      item('at', 292.5, 114, 7.5, 9),
      item('it should do it, including metadata about task performance and', 312, 114, 251.1, 9),
      item('a level of performance that matches much more specialized models.', 49, 128, 251.1, 9)
    ]);

    const firstParagraph = outline.find((block) => block.type === 'paragraph')?.original ?? '';
    expect(firstParagraph).toContain('such as operating an espresso machine out of the box at a level of performance');
    expect(firstParagraph).not.toContain('it should do it');
  });

  it('splits columns even when the next column starts with a short word', () => {
    const outline = buildPdfPageOutline(1, [
      item('Abstract', 58.9, 100, 30.9, 9),
      item('—We present a new robotic foundation model.', 89.8, 100, 210.2, 9),
      item('a', 49, 114, 4.5, 9),
      item('level', 58.9, 114, 17.2, 9),
      item('of', 81.5, 114, 7.5, 9),
      item('performance', 94.4, 114, 49.1, 9),
      item('that', 148.9, 114, 15.4, 9),
      item('matches', 169.8, 114, 31.4, 9),
      item('much', 206.6, 114, 21.4, 9),
      item('more', 233.5, 114, 19.8, 9),
      item('specialized', 258.7, 114, 41.3, 9),
      item('subgoal', 312, 114, 29.4, 9),
      item('images. This enables π0.7 to use very diverse data,', 346.8, 114, 216.3, 9)
    ]);

    const firstParagraph = outline.find((block) => block.type === 'paragraph')?.original ?? '';
    expect(firstParagraph).toContain('a level of performance that matches much more specialized');
    expect(firstParagraph).not.toContain('subgoal images');
  });

  it('does not use filtered front-matter headings as the section name', () => {
    const outline = buildPdfPageOutline(1, [
      item('Physical Intelligence', 250, 80, 160, 14),
      item('This line describes a real paragraph before a formal section appears.', 70, 220, 260, 10)
    ]);

    expect(outline).toHaveLength(1);
    expect(outline[0].section).toBe('Page 1');
  });

  it('filters reference-list entries from AI extraction', () => {
    const outline = buildPdfPageOutline(18, [
      item('REFERENCES', 220, 80, 160, 14),
      item('[36] Huiwon Jang, Sihyun Yu, Heeseung Kwon, Hojin Jeon, Younggyo Seo, and Jinwoo Shin.', 70, 120, 260, 10),
      item('Contextvla: Vision-language-action model with amortized multi-frame context.', 70, 134, 260, 10),
      item('[50] Physical Intelligence Team. π*: a vla that learns from heterogeneous data.', 70, 170, 260, 10)
    ]);

    expect(outline).toEqual([]);
  });

  it('filters bibliography continuations without bracketed reference numbers', () => {
    const outline = buildPdfPageOutline(16, [
      item('Jiajun Wu, Jialin Wu, Jianlan Luo, Jiayuan Gu, Jie Tan, Jihoon Oh, Jitendra Malik,', 70, 120, 260, 10),
      item('Jonathan Tompson, Jonathan Yang, Joseph J. Lim, Karl Pertsch, Karol Hausman, Sergey Levine,', 70, 134, 260, 10),
      item('and Zichen Jeff Cui. Open X-Embodiment: Robotic learning datasets and RT-X models, 2023.', 70, 148, 260, 10),
      item('Ted Xiao, Ashwin Balakrishna, Suraj Nair, Rafael Rafailov, Ethan Foster, Grace Lam,', 70, 184, 260, 10),
      item('et al. Openvla: An open-source vision-language-action model. arXiv preprint arXiv:2406.09246, 2024.', 70, 198, 260, 10)
    ]);

    expect(outline).toEqual([]);
  });

  it('filters appendix contribution author lists', () => {
    const outline = buildPdfPageOutline(19, [
      item('APPENDIX', 70, 80, 100, 14),
      item('A. Contributions', 70, 105, 160, 12),
      item('Data collection and operations. Ashwin Balakrishna, George Bokinsky, Thomas Charbonnier,', 70, 140, 280, 10),
      item('Grace Connors, Michael Equi, Chelsea Finn, Lachlan Groom, Hunter Hancock, Karol Hausman.', 70, 154, 280, 10),
      item('Policy training and research. Bo Ai, Ashwin Balakrishna, Kevin Black, Danny Driess,', 70, 182, 280, 10),
      item('Michael Equi, Yunhao Fang, Chelsea Finn, Catherine Glossop, Haroun Habeeb, Sergey Levine.', 70, 196, 280, 10),
      item('Fig. 19: The model attention pattern uses image goal tokens during inference.', 330, 182, 260, 10),
      item('The world model uses a similar inference-time CFG trick with multiple groups.', 330, 196, 260, 10)
    ]);

    expect(outline).toEqual([]);
  });

  it('filters placeholder glyph noise and formula-like fragments from paragraph candidates', () => {
    const outline = buildPdfPageOutline(6, [
      item('p4□□□ R□□t □□□□ □□□□□', 80, 120, 260, 10),
      item('g_t = G_t,1, ..., G_t,k', 80, 150, 140, 10),
      item('This section describes each part of the prompt contained in the context C_t used by π0.7.', 80, 190, 320, 10)
    ]);

    const paragraphs = outline.filter((block) => block.type === 'paragraph');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].original).toBe(
      'This section describes each part of the prompt contained in the context C_t used by π0.7.'
    );
  });

  it('orders positioned text items by academic reading order for matching', () => {
    const ordered = orderPositionedTextItemsForReading([
      item('right first', 330, 100),
      item('left first', 60, 100),
      item('right second', 330, 114),
      item('left second', 60, 114)
    ]);

    expect(ordered.map((orderedItem) => orderedItem.str)).toEqual([
      'left first',
      'left second',
      'right first',
      'right second'
    ]);
  });
});

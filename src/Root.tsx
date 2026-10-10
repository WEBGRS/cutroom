import React from 'react';
import { Composition, staticFile, type CalculateMetadataFunction } from 'remotion';
import { getImageDimensions } from '@remotion/media-utils';
import { Main } from './Main';
import { Cover, type CoverProps } from './Cover';
import { FxPreview, type PreviewProps } from './FxPreview';
import { LAYOUT } from './lib/layout';
import { loadProps } from './lib/load';
import type { Format, Props, Storyboard } from './lib/types';
import { PROJECTS } from './projects';

const getJson = async <T,>(path: string): Promise<T | undefined> => {
  try {
    const r = await fetch(staticFile(path));
    return r.ok ? ((await r.json()) as T) : undefined;
  } catch {
    return undefined;
  }
};

const getDims = async (path: string) => {
  const d = await getImageDimensions(staticFile(path));
  return { w: d.width, h: d.height };
};

const calc: CalculateMetadataFunction<Props> = async ({ props }) => loadProps(props, getJson, getDims);

const coverCalc: CalculateMetadataFunction<CoverProps> = async ({ props }) => {
  const board = await getJson<Storyboard>(`${props.slug}/storyboard.json`);
  const size = { '169': [1920, 1080], '43': [1440, 1080], '34': [1080, 1440], '916': [1080, 1920] }[props.aspect];
  return { width: size[0], height: size[1], props: { ...props, board } };
};

export const RemotionRoot: React.FC = () => (
  <>
    {/* One effect on sample footage, for the editor's library previews */}
    <Composition id="fx-preview" component={FxPreview} durationInFrames={75} fps={30} width={1920} height={1080} defaultProps={{ cat: 'transition', id: 'whip' } as PreviewProps} />
    {/* Any project: pass the slug in props, e.g. --props='{"slug":"my-video"}' */}
    {(['wide', 'tall'] as Format[]).map((format) => (
      <Composition key={`studio-${format}`} id={`studio-${format}`} component={Main} defaultProps={{ slug: 'demo', format }} calculateMetadata={calc} durationInFrames={60} fps={60} width={LAYOUT[format].W} height={LAYOUT[format].H} />
    ))}
    {PROJECTS.flatMap((slug) =>
      (['wide', 'tall'] as Format[]).map((format) => (
        <Composition key={`${slug}-${format}`} id={`${slug}-${format}`} component={Main} defaultProps={{ slug, format }} calculateMetadata={calc} durationInFrames={60} fps={60} width={LAYOUT[format].W} height={LAYOUT[format].H} />
      )),
    )}
    {PROJECTS.flatMap((slug) =>
      (['169', '43', '34', '916'] as const).map((aspect) => (
        <Composition key={`${slug}-cover-${aspect}`} id={`${slug}-cover-${aspect}`} component={Cover} defaultProps={{ slug, aspect }} calculateMetadata={coverCalc} durationInFrames={1} fps={30} width={1920} height={1080} />
      )),
    )}
  </>
);

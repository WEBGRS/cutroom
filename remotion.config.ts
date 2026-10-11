import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setChromiumOpenGlRenderer('angle');
Config.setCodec('h264');
// A size-capped export sets a bitrate instead, and Remotion refuses both
if (!process.env.CUTROOM_BITRATE) Config.setCrf(16);
Config.setPixelFormat('yuv420p');
Config.setOverwriteOutput(true);

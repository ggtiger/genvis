import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

// Generic colored badge icon — rounded rect with label text
function BadgeIcon({ size = 16, color, label, className }: IconProps & { color: string; label: string }) {
  // Adjust font size based on label length
  const fontSize = label.length <= 2 ? (size * 0.625) : label.length <= 3 ? (size * 0.45) : (size * 0.375);
  const textY = size * 0.72;
  const r = size * 0.125;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" className={className}>
      <rect x={size * 0.0625} y={size * 0.0625} width={size * 0.875} height={size * 0.875} rx={r} fill={color} />
      <text x={size / 2} y={textY} textAnchor="middle" fill="white" fontSize={fontSize} fontWeight="bold" fontFamily="Arial, sans-serif">{label}</text>
    </svg>
  );
}

// Office
export function WordIcon(p: IconProps) { return <BadgeIcon {...p} color="#2B579A" label="W" />; }
export function ExcelIcon(p: IconProps) { return <BadgeIcon {...p} color="#217346" label="X" />; }
export function PowerPointIcon(p: IconProps) { return <BadgeIcon {...p} color="#D24726" label="P" />; }
export function PdfIcon(p: IconProps) { return <BadgeIcon {...p} color="#F40F02" label="PDF" />; }

// Code / Dev
export function JsIcon(p: IconProps) { return <BadgeIcon {...p} color="#F7DF1E" label="JS" />; }
export function TsIcon(p: IconProps) { return <BadgeIcon {...p} color="#3178C6" label="TS" />; }
export function TsxIcon(p: IconProps) { return <BadgeIcon {...p} color="#3178C6" label="TSX" />; }
export function JsxIcon(p: IconProps) { return <BadgeIcon {...p} color="#61DAFB" label="JSX" />; }
export function CssIcon(p: IconProps) { return <BadgeIcon {...p} color="#264DE4" label="CSS" />; }
export function HtmlIcon(p: IconProps) { return <BadgeIcon {...p} color="#E44D26" label="HTM" />; }
export function JsonIcon(p: IconProps) { return <BadgeIcon {...p} color="#A8A8A8" label="{ }" />; }
export function PyIcon(p: IconProps) { return <BadgeIcon {...p} color="#3776AB" label="PY" />; }
export function ShIcon(p: IconProps) { return <BadgeIcon {...p} color="#4EAA25" label="SH" />; }
export function SqlIcon(p: IconProps) { return <BadgeIcon {...p} color="#336791" label="SQL" />; }
export function YamlIcon(p: IconProps) { return <BadgeIcon {...p} color="#CB171E" label="YML" />; }
export function XmlIcon(p: IconProps) { return <BadgeIcon {...p} color="#F48024" label="XML" />; }
export function PhpIcon(p: IconProps) { return <BadgeIcon {...p} color="#777BB4" label="PHP" />; }
export function JavaIcon(p: IconProps) { return <BadgeIcon {...p} color="#ED8B00" label="JAV" />; }
export function CIcon(p: IconProps) { return <BadgeIcon {...p} color="#A8B9CC" label="C" />; }
export function CppIcon(p: IconProps) { return <BadgeIcon {...p} color="#00599C" label="C++" />; }
export function RustIcon(p: IconProps) { return <BadgeIcon {...p} color="#CE422B" label="RS" />; }
export function GoIcon(p: IconProps) { return <BadgeIcon {...p} color="#00ADD8" label="GO" />; }
export function RubyIcon(p: IconProps) { return <BadgeIcon {...p} color="#CC342D" label="RB" />; }
export function VueIcon(p: IconProps) { return <BadgeIcon {...p} color="#42B883" label="VUE" />; }
export function SvelteIcon(p: IconProps) { return <BadgeIcon {...p} color="#FF3E00" label="SVT" />; }
export function ScssIcon(p: IconProps) { return <BadgeIcon {...p} color="#CD6799" label="CSS" />; }
export function TomlIcon(p: IconProps) { return <BadgeIcon {...p} color="#9C4121" label="CFG" />; }

// Text / Docs
export function MdIcon(p: IconProps) { return <BadgeIcon {...p} color="#555555" label="MD" />; }
export function TxtIcon(p: IconProps) { return <BadgeIcon {...p} color="#8C8C8C" label="TXT" />; }

// Media
export function PngIcon(p: IconProps) { return <BadgeIcon {...p} color="#6DB33F" label="PNG" />; }
export function JpgIcon(p: IconProps) { return <BadgeIcon {...p} color="#6DB33F" label="JPG" />; }
export function SvgFileIcon(p: IconProps) { return <BadgeIcon {...p} color="#FFB13B" label="SVG" />; }
export function GifIcon(p: IconProps) { return <BadgeIcon {...p} color="#6DB33F" label="GIF" />; }
export function WebpIcon(p: IconProps) { return <BadgeIcon {...p} color="#6DB33F" label="IMG" />; }
export function Mp4Icon(p: IconProps) { return <BadgeIcon {...p} color="#9B59B6" label="MP4" />; }
export function VideoFileIcon(p: IconProps) { return <BadgeIcon {...p} color="#9B59B6" label="VID" />; }
export function AudioFileIcon(p: IconProps) { return <BadgeIcon {...p} color="#E91E63" label="♪" />; }

// Archive
export function ZipIcon(p: IconProps) { return <BadgeIcon {...p} color="#F39C12" label="ZIP" />; }

// Generic
export function GenericFileIcon(p: IconProps) { return <BadgeIcon {...p} color="#BDBDBD" label="···" />; }

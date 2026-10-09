import {parseStructuredContent, type OrganigrammeCallout} from '../lib/organigrammes';
import {parseMarkdownTables} from '../lib/tableaux';
import {parseFormattingBlocks, parseInlineFormatting, type InlineFormattingNode} from '../lib/formatting';

function InlineNodes({nodes}:{nodes:InlineFormattingNode[]}) {
  return <>{nodes.map((node, index) => {
    switch(node.kind) {
      case 'text': return node.text;
      case 'code': return <code key={index}>{node.text}</code>;
      case 'strong': return <strong key={index}><InlineNodes nodes={node.children}/></strong>;
      case 'emphasis': return <em key={index}><InlineNodes nodes={node.children}/></em>;
      case 'strike': return <s key={index}><InlineNodes nodes={node.children}/></s>;
      case 'link': return <a key={index} className="structured-link" href={node.href} rel="noopener noreferrer"><InlineNodes nodes={node.children}/></a>;
    }
  })}</>;
}

export function InlineContent({text}:{text:string}) {
  return <InlineNodes nodes={parseInlineFormatting(text)}/>;
}

function FormattedText({text}:{text:string}) {
  return <>{parseFormattingBlocks(text).map((block, index) => {
    switch(block.kind) {
      case 'text': return <div key={index} className="structured-content-plain">{block.literal ? block.text : <InlineContent text={block.text}/>}</div>;
      case 'heading': {
        const content = <InlineContent text={block.text}/>;
        switch(block.level) {
          case 1: return <h1 key={index} className="structured-heading">{content}</h1>;
          case 2: return <h2 key={index} className="structured-heading">{content}</h2>;
          case 3: return <h3 key={index} className="structured-heading">{content}</h3>;
          case 4: return <h4 key={index} className="structured-heading">{content}</h4>;
          case 5: return <h5 key={index} className="structured-heading">{content}</h5>;
          default: return <h6 key={index} className="structured-heading">{content}</h6>;
        }
      }
      case 'list': {
        const items = block.items.map((item, row) => <li key={row}><InlineContent text={item}/></li>);
        return block.ordered ? <ol key={index} className="structured-list" start={block.start}>{items}</ol>
          : <ul key={index} className="structured-list">{items}</ul>;
      }
      case 'quote': return <blockquote key={index} className="structured-quote"><div className="structured-content-plain"><InlineContent text={block.text}/></div></blockquote>;
      case 'code': return <pre key={index} className="structured-code"><code>{block.text}</code></pre>;
    }
  })}</>;
}

function TextContent({text}:{text:string}) {
  return <>{parseMarkdownTables(text).map((block, index) => block.kind === 'table'
    ? <div key={index} className="structured-table-scroll" tabIndex={0} role="region" aria-label="Tableau">
      <table className="structured-table">
        <thead><tr>{block.headers.map((header, column) => <th key={column} scope="col" data-align={block.alignments[column] ?? undefined}><InlineContent text={header}/></th>)}</tr></thead>
        <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column} data-align={block.alignments[column] ?? undefined}><InlineContent text={cell}/></td>)}</tr>)}</tbody>
      </table>
    </div>
    : <FormattedText key={index} text={block.text}/>)}</>;
}

function Callout({node}:{node:OrganigrammeCallout}) {
  return <div className="callout" data-callout={node.type}>
    {node.title && <div className="callout-title"><div className="callout-title-inner"><InlineContent text={node.title}/></div></div>}
    <div className="callout-content">
      {node.content.filter(part => part.kind === 'callout' || part.text.trim()).map((part, index) => part.kind === 'callout'
        ? <Callout key={index} node={part}/>
        : <div key={index} className="organigramme-texte"><InlineContent text={part.text}/></div>)}
    </div>
  </div>;
}

export default function StructuredContent({text}:{text:string}) {
  return <div className="structured-content">
    {parseStructuredContent(text).map((block, index) => block.kind === 'diagram'
      ? <Callout key={index} node={block.root}/>
      : <TextContent key={index} text={block.text}/>)}
  </div>;
}

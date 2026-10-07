import {Dialog} from 'radix-ui';
import {X} from 'lucide-react';

type Props = {pending:boolean; message:string; onImport:(file:File)=>Promise<void>};

export default function CampaignImport({pending,message,onImport}:Props) {
  return <Dialog.Root>
    <Dialog.Trigger asChild><button className="import-trigger">Importer des fiches en brouillon</button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="import-backdrop"/>
      <Dialog.Content className="import-dialog">
        <div className="import-dialog-heading">
          <Dialog.Title>Importer des fiches en brouillon</Dialog.Title>
          <Dialog.Close className="icon-button" aria-label="Fermer l’import"><X size={20}/></Dialog.Close>
        </div>
        <Dialog.Description>Sélectionnez votre export JSON privé. L’import conserve les fiches déjà présentes et leurs annotations.</Dialog.Description>
        <input type="file" accept="application/json,.json" disabled={pending} aria-label="Export JSON des fiches" onChange={event=>{
          const file=event.target.files?.[0];
          if(file)void onImport(file);
          event.target.value='';
        }}/>
        {pending&&<p role="status">Import en cours…</p>}
        {message&&<p role="status">{message}</p>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

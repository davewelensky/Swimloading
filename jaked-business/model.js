export const SNAPSHOT='2026-11-16';
export const STAGES=['Enquiry','Quoted','Customer confirmed','Supplier ordered','In transit','Received','Delivered','Cancelled'];
export const DEFAULT_CASE={fx:null,freight:null,insurance:null,fees:null,customsAdditions:null,importVat:null,vatUplift:null,salesVat:null,recovery:null,targetMargin:null,exportBasisConfirmed:false};
export const CASE_FIELDS=[['fx','ZAR per EUR','number'],['freight','Shipment freight · ZAR','number'],['insurance','Insurance · ZAR','number'],['fees','Clearance / other fees · ZAR','number'],['customsAdditions','Customs value additions · ZAR','number'],['importVat','Import VAT · %','percent'],['vatUplift','Import VAT uplift · %','percent'],['salesVat','Sales VAT · %','percent'],['recovery','Recoverable import VAT · %','percent'],['targetMargin','Target gross margin · %','percent']];
export function newLine(label='Product',qty=1){return {id:crypto.randomUUID(),label,sku:'',qty,duty:null,sell:null};}
export function initialState(){return {activeCase:'Base',cases:{Base:{...DEFAULT_CASE},'Freight stress':{...DEFAULT_CASE},'FX stress':{...DEFAULT_CASE}},orders:[{id:crypto.randomUUID(),name:'First Jaked order',customer:'',contact:'',stage:'Enquiry',notes:'3 BLADE wetsuits and 1 swimsuit. Sizes, colours and customer commitments still to confirm.',lines:[newLine('BLADE customer 1'),newLine('BLADE customer 2'),newLine('BLADE customer 3'),newLine('Swimsuit customer'),{...newLine('Optional Atlantic goggles',0),sku:'JKOI9YY01S_001_TU'},newLine('Additional swimsuit',0)]}],inventory:[],media:{}};}
const num=x=>typeof x==='number'&&Number.isFinite(x);
export function parseNumber(v){return String(v).trim()===''?null:Number(v);}
export function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function calculateOrder(order,scenario,products,variants){
 const pp=new Map(products.map(p=>[p.sku,p])),vv=new Map(variants.map(v=>[v.sku,v]));
 const scenarioIssues=[];for(const [k,label]of CASE_FIELDS){const v=scenario[k];if(!num(v)||v<0||(k==='fx'&&v===0)||(['importVat','vatUplift','salesVat','recovery','targetMargin'].includes(k)&&v>1)||(k==='targetMargin'&&v>=1))scenarioIssues.push(label);}
 if(!scenario.exportBasisConfirmed)scenarioIssues.push('Supplier export price basis');
 const demand={};for(const l of order.lines)if(l.qty>0&&l.sku)demand[l.sku]=(demand[l.sku]||0)+l.qty;
 const lines=order.lines.map(l=>{const v=vv.get(l.sku),p=v&&pp.get(v.parent);const errors=[];if(!Number.isInteger(l.qty)||l.qty<0)errors.push('Invalid quantity');if(l.qty>0&&!v)errors.push('Select a variant');if(l.qty>0&&(!p||!num(p.wholesale)))errors.push('No supplier price');const goods=errors.length?null:l.qty===0?0:l.qty*p.wholesale;return {...l,variant:v,product:p,goods,errors,stockWarning:l.qty>0&&v&&(demand[l.sku]>v.ws)?`Demand ${demand[l.sku]} exceeds WS snapshot ${v.ws}`:null};});
 const completeGoods=lines.every(l=>num(l.goods));const goods=completeGoods?lines.reduce((a,l)=>a+l.goods,0):null;
 for(const l of lines){if(l.qty===0)continue;if(!num(l.duty)||l.duty<0||l.duty>1)l.errors.push('Duty rate');if(!completeGoods)l.errors.push('Incomplete order pricing');if(scenarioIssues.length)l.errors.push('Scenario inputs');
  if(l.errors.length)continue;
  const share=goods>0?l.goods/goods:0;l.goodsZar=l.goods*scenario.fx;l.freight=scenario.freight*share;l.insurance=scenario.insurance*share;l.fees=scenario.fees*share;l.customsValue=l.goodsZar+scenario.customsAdditions*share;l.dutyZar=l.customsValue*l.duty;l.importVat=(l.customsValue*(1+scenario.vatUplift)+l.dutyZar)*scenario.importVat;l.cash=l.goodsZar+l.freight+l.insurance+l.fees+l.dutyZar+l.importVat;l.economic=l.cash-l.importVat*scenario.recovery;l.targetUnit=l.economic/l.qty/(1-scenario.targetMargin)*(1+scenario.salesVat);
  if(num(l.sell)&&l.sell>0){l.revenue=l.qty*l.sell/(1+scenario.salesVat);l.profit=l.revenue-l.economic;l.margin=l.profit/l.revenue;}
 }
 const active=lines.filter(l=>l.qty>0),costReady=active.length>0&&active.every(l=>num(l.cash)),saleReady=costReady&&active.every(l=>num(l.revenue));
 const sum=k=>active.reduce((a,l)=>a+l[k],0);return {lines,goods,units:order.lines.reduce((a,l)=>a+(num(l.qty)?l.qty:0),0),scenarioIssues,costReady,saleReady,cash:costReady?sum('cash'):null,economic:costReady?sum('economic'):null,revenue:saleReady?sum('revenue'):null,profit:saleReady?sum('profit'):null,margin:saleReady&&sum('revenue')>0?sum('profit')/sum('revenue'):null};
}
export function inventoryBalance(entries,sku){return entries.filter(e=>e.sku===sku).reduce((a,e)=>a+e.qty,0);}
export function csv(rows){const quote=x=>'"'+String(x??'').replaceAll('"','""').replace(/^[=+@-]/,"'$&")+'"';return rows.map(r=>r.map(quote).join(',')).join('\r\n');}

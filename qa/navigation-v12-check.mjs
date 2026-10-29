import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parseHTML,installDOM,EventStub,makeElement} from './dom-v5-harness.mjs';
import {nextFocus,focusableControls,ScreenNavigation,adjustRange,isTextEntry,cycleTab} from '../dist/navigation.js';
import {VirtualKeyboard} from '../dist/virtual-keyboard.js';

const report={status:'pending',checks:[],limit:'Functional DOM behavior, including actual navigation and text-entry modules; no physical controller or rendered-layout claim.'};
const check=(name,fn)=>{fn();report.checks.push(name);console.log('PASS '+name);};
const {doc}=parseHTML('<body><div id="menu"><button id="start">Start</button><button id="settings-open">Settings</button></div><div id="modal-wrap"><section id="settings-modal"><button id="close-settings">Back</button><input id="volume" type="range" min="0" max="1" step="0.01" value="0.7"><input id="driver" type="text"><button id="controls-open">Controls</button><details id="network"><summary id="network-summary">Connection</summary><input id="network-host" type="text"></details></section><section id="controls-modal"><button id="close-controls">Back</button><button id="bind">Bind</button></section></div><aside id="already-inert" inert><button>Unavailable</button></aside></body>');
installDOM(doc);const $=id=>doc.getElementById(id),nav=new ScreenNavigation(doc);
$('already-inert').inert=true;

check('Text fields are editable while ranges and checkboxes remain navigation controls',()=>{
 assert.equal(isTextEntry($('driver')),true);assert.equal(isTextEntry($('volume')),false);const box=makeElement(doc,'input','checkbox');box.type='checkbox';assert.equal(isTextEntry(box),false);box.remove();
});
check('Nested screens restore exact origin and preserve unrelated inert attributes',()=>{
 nav.enter($('menu'),{modal:false});nav.focus($('settings-open'));nav.enter($('settings-modal'));assert.equal($('menu').inert,true);assert.equal($('controls-modal').inert,true);nav.focus($('controls-open'));
 nav.enter($('controls-modal'));assert.equal(nav.returnTarget(),$('settings-modal'));nav.focus($('bind'));nav.enter($('settings-modal'));assert.equal(nav.restore(),$('controls-open'));assert.equal(nav.returnTarget(),$('menu'));
 nav.reset($('menu'));assert.equal(nav.restore(),$('settings-open'));assert.equal($('menu').inert,false);assert.equal($('already-inert').inert,true);
});
check('Removed and rebuilt cards recover focus by stable nav key',()=>{
 nav.enter($('settings-modal'));const old=makeElement(doc,'button',null,$('settings-modal'));old.dataset.navKey='exhaust-race';nav.focus(old);nav.enter($('controls-modal'));old.remove();const replacement=makeElement(doc,'button',null,$('settings-modal'));replacement.dataset.navKey='exhaust-race';nav.enter($('settings-modal'));assert.equal(nav.restore(),replacement);replacement.remove();
});
check('Summary is navigable; closed details exclude their inputs and opened details include them',()=>{
 let list=focusableControls($('settings-modal'));assert.ok(list.includes($('network-summary')));assert.ok(!list.includes($('network-host')));$('network').open=true;list=focusableControls($('settings-modal'));assert.ok(list.includes($('network-host')));$('network').open=false;
});
check('Tab and reverse Tab wrap inside the current modal and recover from outside focus',()=>{
 const list=focusableControls($('settings-modal'));nav.focus(list.at(-1));const forward=new EventStub('keydown',{key:'Tab'});doc.dispatchEvent(forward);assert.equal(doc.activeElement,list[0]);assert.equal(forward.defaultPrevented,true);
 doc.dispatchEvent(new EventStub('keydown',{key:'Tab',shiftKey:true}));assert.equal(doc.activeElement,list.at(-1));doc.activeElement=$('menu');doc.dispatchEvent(new EventStub('keydown',{key:'Tab',shiftKey:true}));assert.equal(doc.activeElement,list.at(-1));
});
check('Fractional ranges change once, clamp at their bounds and emit both form events',()=>{
 let inputs=0,changes=0;$('volume').addEventListener('input',()=>inputs++);$('volume').addEventListener('change',()=>changes++);assert.equal(adjustRange($('volume'),1),true);assert.equal($('volume').value,'0.71');assert.equal(inputs,1);assert.equal(changes,1);$('volume').value='1';adjustRange($('volume'),1);assert.equal(inputs,1);$('volume').disabled=true;assert.equal(adjustRange($('volume'),-1),false);$('volume').disabled=false;
});
check('Explicit neighbors beat geometry and horizontal groups retain their own row',()=>{
 const group=makeElement(doc,'div',null,$('settings-modal'));group.dataset.navGroup='parts';const a=makeElement(doc,'button','a',group),b=makeElement(doc,'button','b',group),c=makeElement(doc,'button','c',$('settings-modal'));assert.equal(nextFocus([a,b,c],b,'right'),a);b.dataset.navDown='c';assert.equal(nextFocus([a,b,c],b,'down'),c);group.remove();c.remove();
});
check('Shoulder tab cycling wraps visible tabs and executes the selected tab handler',()=>{
 const a=makeElement(doc,'button','tab-a',$('settings-modal')),b=makeElement(doc,'button','tab-b',$('settings-modal'));a.setAttribute('role','tab');b.setAttribute('role','tab');a.setAttribute('aria-selected','true');let selected=0;b.addEventListener('click',()=>selected++);assert.equal(cycleTab($('settings-modal'),-1,el=>nav.focus(el)),true);assert.equal(selected,1);assert.equal(doc.activeElement,b);a.remove();b.remove();
});

const keyboard=new VirtualKeyboard(nav,{doc});
check('Controller keyboard commits bounded text once and restores its exact input',()=>{
 const input=$('driver');input.maxLength=18;input.value='DRIVER';nav.focus(input);let changes=0;input.addEventListener('change',()=>changes++);assert.equal(keyboard.open(input),true);assert.equal(nav.scope,keyboard.root);keyboard.field.setSelectionRange=(a,b)=>{keyboard.field.selectionStart=a;keyboard.field.selectionEnd=b;};keyboard.caret(6);keyboard.insert(' 09');assert.equal(input.value,'DRIVER');keyboard.close(true);assert.equal(input.value,'DRIVER 09');assert.equal(changes,1);assert.equal(doc.activeElement,input);assert.equal(keyboard.field.value,'');
});
check('Cancel discards a network credential draft and clears sensitive memory',()=>{
 const password=makeElement(doc,'input','password',$('settings-modal'));password.type='password';password.value='original';nav.focus(password);keyboard.open(password);assert.equal(keyboard.field.type,'password');keyboard.field.value='new secret';keyboard.handleAction('back');assert.equal(password.value,'original');assert.equal(keyboard.field.value,'');assert.equal(keyboard.target,null);assert.equal(nav.scope,$('settings-modal'));assert.equal(doc.activeElement,password);password.remove();
});
check('Full punctuation, uppercase, cursor insertion, delete and maximum length are available',()=>{
 const input=$('driver');input.maxLength=5;input.value='abcd';nav.focus(input);keyboard.open(input);keyboard.caret(2);keyboard.insert('XYZ');assert.equal(keyboard.field.value,'abXcd');keyboard.erase();assert.equal(keyboard.field.value,'abcd');keyboard.caret(4);keyboard.insert(':');assert.equal(keyboard.field.value,'abcd:');keyboard.symbols=true;keyboard.renderKeys();const symbols=keyboard.keys.querySelectorAll('button').map(b=>b.textContent).join('');for(const c of ':/.@-_\\[]{}~`')assert.ok(symbols.includes(c));keyboard.symbols=false;keyboard.upper=true;keyboard.renderKeys();assert.equal($('keyboard-key-1-0').textContent,'Q');keyboard.close(false);
});
check('Controller confirmation clicks keys and direction stays inside the keyboard',()=>{
 $('driver').value='';keyboard.open($('driver'));keyboard.handleAction('confirm');assert.equal(keyboard.field.value,'1');keyboard.handleAction('menuRight');assert.equal(doc.activeElement.id,'keyboard-key-0-1');keyboard.handleAction('confirm');assert.equal(keyboard.field.value,'12');keyboard.handleAction('home');assert.equal(keyboard.active,false);assert.equal($('driver').value,'');
});
nav.destroy();report.status='passed';fs.writeFileSync(new URL('./navigation-v12-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));

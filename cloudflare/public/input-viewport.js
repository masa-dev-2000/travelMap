// One scroll owner: the form, not window. Never reset the page to its top.
export function scrollDelta(rect, top, bottom, gap=10) {
  const available=bottom-top-2*gap;
  if(rect.height>available) return rect.top-top-gap;
  if(rect.bottom>bottom-gap) return rect.bottom-bottom+gap;
  if(rect.top<top+gap) return rect.top-top-gap;
  return 0;
}
export function installInputViewport(form) {
  const viewport=window.visualViewport,footer=form.querySelector('.bottom');
  let frame=0,requested=null;
  function fit() {
    frame=0;
    const height=viewport?.height || innerHeight,offset=viewport?.offsetTop || 0;
    if(!viewport || viewport.scale===1) {
      form.style.height=`${height}px`;
      form.style.transform=offset?`translateY(${offset}px)`:'';
    }
    const target=requested || document.activeElement;requested=null;
    if(!target || !form.contains(target) || target.closest('[hidden]'))return;
    const area=form.getBoundingClientRect(),foot=footer?.getBoundingClientRect();
    const top=Math.max(area.top,offset),bottom=Math.min(area.bottom,offset+height,foot?.top ?? Infinity);
    const input=target.matches('textarea')?target:target.querySelector?.('textarea');
    if(input) input.style.maxHeight=`${Math.max(48,bottom-top-24)}px`;
    const rect=target.getBoundingClientRect();
    // Native textarea scrolling keeps its caret inside the now bounded control.
    const delta=scrollDelta(rect,top,bottom);
    if(Math.abs(delta)>1)form.scrollTop+=delta;
  }
  function schedule(target) {if(target)requested=target;if(!frame)frame=requestAnimationFrame(fit);}
  const reveal=event=>schedule(event.target),resize=()=>schedule();
  form.addEventListener('focusin',reveal);form.addEventListener('input',reveal);
  viewport?.addEventListener('resize',resize);viewport?.addEventListener('scroll',resize);
  window.addEventListener('orientationchange',resize);schedule();
  return {reveal:schedule,dispose(){cancelAnimationFrame(frame);form.removeEventListener('focusin',reveal);form.removeEventListener('input',reveal);viewport?.removeEventListener('resize',resize);viewport?.removeEventListener('scroll',resize);window.removeEventListener('orientationchange',resize);}};
}

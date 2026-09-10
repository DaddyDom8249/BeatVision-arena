/*
 * BeatVision Arena motion payload compatibility.
 *
 * Normalize the live scene-image result at the browser/gateway boundary.
 * The image stage may return either a direct generated-image object or a
 * wrapped image collection. Motion should accept both forms.
 */
(function(){
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const rawUrl=typeof input==='string'?(input):(input&&input.url)||'';
    let pathname=rawUrl;
    try{pathname=new URL(rawUrl,window.location.href).pathname}catch(e){}
    if(pathname==='/v1/video/animate'&&init&&typeof init.body==='string'){
      try{
        const body=JSON.parse(init.body);
        const payload=body?.payload;
        const images=payload?.images;
        const direct=images?.image_url||images?.url||images?.data_url||images?.result?.image_url||images?.result?.url||images?.result?.data_url;
        if(direct){
          const item=images?.result?.image_url?images.result:images;
          payload.images=Array.isArray(images)?{images}:({images:[item]});
          init={...init,body:JSON.stringify(body)};
        }
      }catch(e){}
    }
    return nativeFetch(input,init);
  };
})();

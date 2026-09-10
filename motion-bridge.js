/*
 * BeatVision Arena motion payload compatibility.
 *
 * The live image stage currently returns one generated image object while
 * the video contract accepts an images collection. Normalize that boundary
 * in the browser so Motion receives the generated image instead of rejecting
 * a valid image object as "missing".
 */
(function(){
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:(input&&input.url)||'';
    if(url.endsWith('/v1/video/animate')&&init&&typeof init.body==='string'){
      try{
        const body=JSON.parse(init.body);
        const images=body?.payload?.images;
        if(images&&typeof images==='object'&&!Array.isArray(images)){
          const direct=images.image_url||images.url||images.data_url;
          if(direct){
            body.payload.images={images:[images]};
            init={...init,body:JSON.stringify(body)};
          }
        }
      }catch(e){}
    }
    return nativeFetch(input,init);
  };
})();

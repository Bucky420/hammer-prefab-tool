/* Small local Three-compatible foundation used by the editor. No network or package dependency. */
export class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x=x; this.y=y; this.z=z; } clone(){return new Vector3(this.x,this.y,this.z)} set(x,y,z){this.x=x;this.y=y;this.z=z;return this} }
export class Color { constructor(value="#ffffff"){this.set(value)} set(value){this.value=value;return this} }
export class Scene { constructor(){this.children=[]} add(object){this.children.push(object)} }
export class PerspectiveCamera { constructor(fov=60,aspect=1,near=.1,far=10000){Object.assign(this,{fov,aspect,near,far,position:new Vector3()})} }
export class OrthographicCamera { constructor(left=-1,right=1,top=1,bottom=-1,near=.1,far=10000){Object.assign(this,{left,right,top,bottom,near,far,position:new Vector3()})} }
export class WebGLRenderer { constructor({canvas}){this.domElement=canvas;this.context=canvas.getContext("2d");this.clearColor="#121620"} setSize(w,h){canvas.width=w;canvas.height=h} setClearColor(c){this.clearColor=c} render(){const c=this.context;c.fillStyle=this.clearColor;c.fillRect(0,0,this.domElement.width,this.domElement.height)} }

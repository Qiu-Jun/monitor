# 监控前端接入依赖包

## 定义

> 前端监控，用于捕获，分析，和报告网站或应用程序中的异常，错误和性能问题的方法

### 全局错误监控

```js
window.onerror = function (msg, url, lineNo, columnNo, error) {
  console.log("异步错误！");
  console.log("错误描述:" + msg);
  console.log("报错文件:" + url);
  console.log("行号:" + lineNo);
  console.log("列号:" + columnNo);
  console.log("错误对象:" + error);
};
```

`return true` 阻止阻止默认浏览器行为，如异常信息不会在 console 中打印

### promise 错误监控

```js
// 全局监听 unhandledrejection 事件来捕获未被处理的 Promise 错误
window.addEventListener("unhandledrejection", (event) => {
  // 捕获未被处理的 Promise 错误
  console.error(event.reason);
});
```

### 资源加载错误监控

```js
window.addEventListener("error", (event) => {
  console.log(event.target.src);
});
```

和 `window.onerror` 区别在于 `window.addEventListener` 可以监听到所有资源加载错误，包括图片、css、js 等等
并且无法阻止默认浏览器行为

## 埋点方式

1. 手动埋点

   > 框架提供一键上报异常的方法，可以上报自定义异常信息
   > 使用场景如：方法里，try catch 中

2. 无恒埋点

   > 通过全局监听事件，上报异常信息


## 性能指标分析

1. 报错信息可视化统计，定位，提醒
2. 用户体验关键指标数据       
3. 业务相关：pv，uv，页面停留时间
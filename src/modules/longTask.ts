import { getLastEvent, getSelector } from "../utils";
import type { LongTaskLog } from "../interface";
export default function onLongTask() {
  if (PerformanceObserver) {
    const observerLongTask = new PerformanceObserver(list => {
      list.getEntries().forEach(entry => {
        // 执行时长大于 100 ms
        if (entry.duration > 100) {
          const lastEvent = getLastEvent();

          const log: LongTaskLog = {
            type: "longTask",
            startTime: entry.startTime, // 开始时间
            duration: entry.duration, // 持续时间
            selector: lastEvent ? getSelector() : "",
            eventType: lastEvent?.type,
          };
          console.log("longTask log: ", log);

          // @ts-ignore
          this.send(log);
        }
      });
    });

    observerLongTask.observe({ entryTypes: ["longtask"] });
  }
}
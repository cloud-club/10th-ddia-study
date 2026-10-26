---
type: note
author: example
created: 2026-10-24
status: completed
tags: [consensus, replication]
---

# 예시: 합의와 리더 선출

> 대시보드 그래프 확인을 위한 예시이며 실제 참여자 기록이 아닙니다.

## 이번에 답하려는 질문

리더가 변경되는 동안 쓰기 요청의 재시도와 중복 적용은 어떻게 다룰까?

## 한 줄 요약

복제본을 두는 것과 장애 상황에서도 하나의 결정을 안전하게 합의하는 것은 다른 문제다.

## 핵심 내용

리더 선출에서는 여러 후보가 동시에 자신이 리더라고 행동하지 않도록 해야 한다. 네트워크 지연과 장애를 구별하기 어려우므로, 안전성과 진행 가능성을 나누어 생각한다.

## 남은 질문

리더가 변경되는 동안 쓰기 요청의 재시도와 중복 적용은 어떻게 다룰까?

## 참고 자료

- [Martin Kleppmann, Designing Data-Intensive Applications — Chapter 9: Consistency and Consensus](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781491903063/ch09.html)

---
type: note
author: example
created: 2026-10-24
status: completed
tags: [transactions, consistency]
---

# 예시: 트랜잭션 격리와 동시성

> 작성·집계 흐름을 확인하기 위한 테스트 노트입니다. `example`은 실제 참여자가 아닌 테스트용 작성자이며, 일반 노트와 동일하게 집계됩니다.

## 이번에 답하려는 질문

선택한 격리 수준에서 갱신 손실을 재현하는 테스트를 어떻게 만들까?

## 한 줄 요약

트랜잭션을 사용한다는 사실만으로 모든 동시성 이상이 사라지는 것은 아니며, 실제 격리 수준의 보장을 확인해야 한다.

## 핵심 내용

같은 값을 읽은 두 요청이 각각 갱신하면 한쪽 결과가 덮어써질 수 있다. 데이터베이스의 격리 수준, 원자적 갱신, 명시적 잠금, 충돌 검출이 어떤 이상을 방지하는지 구분한다.

## 남은 질문

선택한 격리 수준에서 갱신 손실을 재현하는 테스트를 어떻게 만들까?

## 참고 자료

- [Martin Kleppmann, Designing Data-Intensive Applications — Chapter 7: Transactions](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781491903063/ch07.html)

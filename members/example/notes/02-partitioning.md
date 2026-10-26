---
type: note
author: example
created: 2026-10-24
status: completed
tags: [partitioning, replication]
---

# 예시: 파티셔닝과 핫스팟

> 작성·집계 흐름을 확인하기 위한 테스트 노트입니다. `example`은 실제 참여자가 아닌 테스트용 작성자이며, 일반 노트와 동일하게 집계됩니다.

## 이번에 답하려는 질문

키 하나에 요청이 몰릴 때 분할 키 변경과 캐시 중 무엇을 먼저 검증할까?

## 한 줄 요약

파티셔닝은 데이터를 나누고, 복제는 같은 데이터를 여러 곳에 유지한다. 두 방식은 함께 사용할 수 있지만 목적은 다르다.

## 핵심 내용

키 범위로 나누면 범위 조회가 편리하지만 특정 구간에 쓰기가 몰릴 수 있다. 해시 기반 분산도 특정 인기 키 하나의 부하까지 자동으로 해결하지는 않는다.

## 남은 질문

키 하나에 요청이 몰릴 때 분할 키 변경과 캐시 중 무엇을 먼저 검증할까?

## 참고 자료

- [Martin Kleppmann, Designing Data-Intensive Applications — Chapter 6: Partitioning](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781491903063/ch06.html)

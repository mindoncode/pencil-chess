import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BoardEmbedComponent } from './board-embed.component';

describe('BoardEmbedComponent', () => {
  let component: BoardEmbedComponent;
  let fixture: ComponentFixture<BoardEmbedComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [BoardEmbedComponent]
    });
    fixture = TestBed.createComponent(BoardEmbedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

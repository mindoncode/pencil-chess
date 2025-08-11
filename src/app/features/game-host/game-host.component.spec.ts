import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GameHostComponent } from './game-host.component';

describe('GameHostComponent', () => {
  let component: GameHostComponent;
  let fixture: ComponentFixture<GameHostComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [GameHostComponent]
    });
    fixture = TestBed.createComponent(GameHostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

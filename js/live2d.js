(function initCuteLive2d() {
  if (!window.OML2D?.loadOml2d) return;

  const hoverMessages = [
    '好好上班，团子在陪着你～',
    '团子说：今天也要元气满满哦',
    '别着急，慢慢来，团子给你加油',
    '看完这份简历，记得喝口水呀',
    '团子在旁边看着你认真工作呢',
    '累了就歇一会儿，团子不会催你的',
    '今天也要好好招人，团子为你打气！',
    '面试纪要写清楚一点，团子给你比心',
    '上传附件能让反馈更准哦～',
    '团子说：找到合适的人就超级棒',
    '你已经很努力啦，团子抱抱',
    '好好上班，团子在家等你回来～',
    '这一份也认真看，团子陪着你',
    '工作再忙，也别忘了对自己好一点',
    '团子小声说：你是最棒的招聘官',
  ];
  let hoverIndex = 0;

  try {
    const oml2d = window.OML2D.loadOml2d({
      mobileDisplay: true,
      primaryColor: '#c45c7a',
      dockedPosition: 'left',
      menus: {
        disable: true,
      },
      statusBar: {
        disable: true,
      },
      models: [
        {
          name: 'Rem',
          path: 'https://cdn.jsdelivr.net/gh/oh-my-live2d/live2d-models@main/models/rem/model.json',
          position: [-8, 50],
          scale: 0.078,
          stageStyle: {
            width: 200,
            height: 300,
            left: '-20px',
            overflow: 'visible',
          },
          mobileScale: 0.058,
          mobilePosition: [-8, 30],
          mobileStageStyle: {
            width: 140,
            height: 210,
            left: '-12px',
            overflow: 'visible',
          },
        },
      ],
      tips: {
        style: {
          fontSize: '12px',
          width: '150px',
          minHeight: 'auto',
          height: 'auto',
          top: '-42px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#fff8f1',
          color: '#6b4f3a',
          border: '1px solid #f0d7c2',
          borderRadius: '12px',
          boxShadow: '0 8px 20px rgba(120, 80, 50, 0.12)',
          padding: '6px 10px',
        },
        mobileStyle: {
          fontSize: '11px',
          width: '130px',
          minHeight: 'auto',
          height: 'auto',
          top: '-34px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#fff8f1',
          color: '#6b4f3a',
          border: '1px solid #f0d7c2',
          borderRadius: '10px',
          padding: '5px 8px',
        },
        idleTips: {
          interval: 10000,
          message: hoverMessages,
        },
        welcomeTips: {
          message: {
            morning: '早上好呀，好好上班，团子在陪着你～',
            noon: '中午好，歇一会儿，团子也不会催你',
            afternoon: '下午好，团子说今天也要元气满满哦',
            evening: '晚上好，辛苦啦，团子给你加油',
            night: '这么晚还在忙，团子抱抱你',
          },
          duration: 4000,
        },
      },
    });

    const enableStageDrag = stage => {
      if (!stage || stage.dataset.dragBound === '1') return;
      stage.dataset.dragBound = '1';

      let dragging = false;
      let moved = false;
      let startX = 0;
      let startY = 0;
      let baseX = Number(stage.dataset.dragX || 0);
      let baseY = Number(stage.dataset.dragY || 0);

      const applyTransform = (x, y) => {
        stage.dataset.dragX = String(x);
        stage.dataset.dragY = String(y);
        stage.style.setProperty('transform', `translate3d(${x}px, ${y}px, 0)`, 'important');
        stage.style.setProperty('transition', 'none', 'important');
      };

      // 等插件入场动画结束后，清掉它自带的 transform，避免叠加导致飞出屏幕
      window.setTimeout(() => {
        if (!stage.dataset.dragReady) {
          stage.dataset.dragReady = '1';
          applyTransform(baseX, baseY);
        }
      }, 1200);

      const onPointerMove = event => {
        if (!dragging) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        applyTransform(baseX + dx, baseY + dy);
      };

      const stopDrag = event => {
        if (!dragging) return;
        dragging = false;
        stage.classList.remove('is-dragging');
        baseX = Number(stage.dataset.dragX || 0);
        baseY = Number(stage.dataset.dragY || 0);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', stopDrag);
        window.removeEventListener('pointercancel', stopDrag);

        // 如果只是点击没怎么移动，不干扰点击反馈
        if (!moved && event) {
          // no-op
        }
      };

      stage.addEventListener('pointerdown', event => {
        if (event.button !== undefined && event.button !== 0) return;
        if (!stage.dataset.dragReady) {
          stage.dataset.dragReady = '1';
          applyTransform(baseX, baseY);
        }
        dragging = true;
        moved = false;
        stage.classList.add('is-dragging');
        startX = event.clientX;
        startY = event.clientY;
        baseX = Number(stage.dataset.dragX || 0);
        baseY = Number(stage.dataset.dragY || 0);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', stopDrag);
        window.addEventListener('pointercancel', stopDrag);
      });
    };

    const bindHoverTips = () => {
      const stage = document.querySelector('.oml2d-stage') || document.querySelector('#oml2d-stage') || document.querySelector('[class*="oml2d"] canvas')?.parentElement;
      if (!stage) return;

      enableStageDrag(stage);

      if (stage.dataset.hoverTipsBound === '1') return;
      stage.dataset.hoverTipsBound = '1';

      stage.addEventListener('mouseenter', () => {
        if (stage.classList.contains('is-dragging')) return;
        const message = hoverMessages[hoverIndex % hoverMessages.length];
        hoverIndex += 1;
        if (typeof oml2d?.tipsMessage === 'function') {
          oml2d.tipsMessage(message, 3500, 10);
        } else if (typeof oml2d?.showTipsMessage === 'function') {
          oml2d.showTipsMessage(message, 3500, 10);
        }
      });
    };

    if (typeof oml2d?.onLoad === 'function') {
      oml2d.onLoad(status => {
        if (status === 'success') bindHoverTips();
      });
    }
    if (typeof oml2d?.onStageSlideIn === 'function') {
      oml2d.onStageSlideIn(bindHoverTips);
    }
    window.setTimeout(bindHoverTips, 1500);
    window.setTimeout(bindHoverTips, 4000);
  } catch (error) {
    console.warn('Live2D 看板娘加载失败', error);
  }
})();
